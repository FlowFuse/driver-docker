const got = require('got')
const FormData = require('form-data')
const Docker = require('dockerode')
const path = require('path')
const { chownSync, mkdirSync, rmSync } = require('fs')

const createContainer = async (project, domain) => {
    const stack = project.ProjectStack.properties
    const contOptions = {
        Image: stack.container,
        name: project.id, // options.name,
        Env: [],
        Labels: {
            flowforge: 'project'
        },
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        HostConfig: {
            NetworkMode: this._network,
            RestartPolicy: {
                Name: 'unless-stopped'
            }
        }
    }

    if (stack) {
        if (stack.cpu) {
            contOptions.HostConfig.NanoCpus = ((Number(stack.cpu) / 100) * (10 ** 9))
        }
        if (stack.memory) {
            contOptions.HostConfig.Memory = Number(stack.memory) * (1024 * 1024)
        }
    }

    // TODO http/https needs to be dynamic (or we just enforce https?)
    // and port number
    const baseURL = new URL(this._app.config.base_url)
    let projectURL
    if (!project.url.startsWith('http')) {
        projectURL = `${baseURL.protocol}//${project.safeName}.${this._options.domain}`
    } else {
        const temp = new URL(project.url)
        projectURL = `${temp.protocol}//${temp.hostname}${temp.port ? ':' + temp.port : ''}`
    }
    const url = new URL(projectURL)
    const hostname = url.hostname
    const teamID = this._app.db.models.Team.encodeHashid(project.TeamId)
    const authTokens = await project.refreshAuthTokens()

    // AuthProvider
    contOptions.Env.push('FORGE_CLIENT_ID=' + authTokens.clientID)
    contOptions.Env.push('FORGE_CLIENT_SECRET=' + authTokens.clientSecret)
    // TODO this needs to come from a central point
    contOptions.Env.push('FORGE_URL=' + this._app.config.api_url)
    contOptions.Env.push(`BASE_URL=${projectURL}`)
    contOptions.Env.push(`VIRTUAL_HOST=${hostname}`)
    if (baseURL.protocol === 'https:') {
        contOptions.Env.push(`LETSENCRYPT_HOST=${hostname}`)
    }
    contOptions.Env.push('VIRTUAL_PORT=1880')
    // httpStorage settings
    contOptions.Env.push(`FORGE_PROJECT_ID=${project.id}`)
    contOptions.Env.push(`FORGE_PROJECT_TOKEN=${authTokens.token}`)
    // Inbound connections for docker disabled by default
    contOptions.Env.push('FORGE_NR_NO_TCP_IN=true') // MVP. Future iteration could present this to YML or UI
    contOptions.Env.push('FORGE_NR_NO_UDP_IN=true') // MVP. Future iteration could present this to YML or UI
    // common
    contOptions.Env.push(`FORGE_TEAM_ID=${teamID}`)
    // broker settings
    if (authTokens.broker) {
        contOptions.Env.push(`FORGE_BROKER_URL=${authTokens.broker.url}`)
        contOptions.Env.push(`FORGE_BROKER_USERNAME=${authTokens.broker.username}`)
        contOptions.Env.push(`FORGE_BROKER_PASSWORD=${authTokens.broker.password}`)
    }
    if (this._app.license.active()) {
        contOptions.Env.push('FORGE_LICENSE_TYPE=ee')
    }

    if (stack.memory) {
        contOptions.Env.push(`FORGE_MEMORY_LIMIT=${stack.memory}`)
    }

    if (stack.cpu) {
        contOptions.Env.push(`FORGE_CPU_LIMIT=${stack.cpu}`)
    }

    const credentialSecret = await project.getSetting('credentialSecret')
    if (credentialSecret) {
        contOptions.Env.push(`FORGE_NR_SECRET=${credentialSecret}`)
    }

    if (this._app.config.driver.options?.logPassthrough) {
        contOptions.Env.push('FORGE_LOG_PASSTHROUGH=true')
    }

    if (this._app.config.driver.options?.privateCA) {
        if (contOptions.HostConfig?.Binds) {
            contOptions.HostConfig.Binds.push(`${this._app.config.driver.options.privateCA}:/usr/local/ssl-certs/chain.pem`)
        } else {
            contOptions.HostConfig.Binds = [
                `${this._app.config.driver.options.privateCA}:/usr/local/ssl-certs/chain.pem`
            ]
        }
        contOptions.Env.push('NODE_EXTRA_CA_CERTS=/usr/local/ssl-certs/chain.pem')
    }

    if (this._app.config.driver.options?.storage?.enabled && this._app.config.driver.options?.storage?.path) {
        try {
            const localPath = path.join('/opt/persistent-storage', project.id)
            console.log(`Creating dir in container ${localPath}`)
            mkdirSync(localPath)
            chownSync(localPath, 1000, 1000)
        } catch (err) {
            this._app.log.info(`[docker] problem creating persistent storage for ${project.id}`)
        }
        const projectPath = path.join(this._app.config.driver.options?.storage?.path, project.id)
        if (Array.isArray(contOptions.HostConfig?.Binds)) {
            contOptions.HostConfig.Binds.push(`${projectPath}:/data/storage`)
        } else {
            contOptions.HostConfig.Binds = [
                `${projectPath}:/data/storage`
            ]
        }
    }

    const containerList = await this._docker.listImages()
    let containerFound = false
    let stackName = stack.container
    // add ":latest" to stack containers with no tag
    if (stackName.indexOf(':') === -1) {
        stackName = stackName + ':latest'
    }
    for (const cont of containerList) {
        if (cont.RepoTags.includes(stackName)) {
            containerFound = true
            break
        }
    }

    if (!containerFound) {
        this._app.log.info(`Container for stack ${project.ProjectStack.name} not found, pulling ${stack.container}`)
        // https://github.com/apocas/dockerode/issues/703
        try {
            await new Promise((resolve, reject) => {
                this._docker.pull(stack.container, (err, stream) => {
                    if (!err) {
                        this._docker.modem.followProgress(stream, onFinished)
                        function onFinished (err, output) {
                            if (!err) {
                                resolve(true)
                                return
                            }
                            reject(err)
                        }
                    } else {
                        reject(err)
                    }
                })
            })
        } catch (err) {
            this._app.log.debug(`Error pulling image ${stack.container} ${err.message}`)
        }
    }

    const container = await this._docker.createContainer(contOptions)
    return container.start()
        .then(async () => {
            this._app.log.debug(`Container ${project.id} started [${container.id.substring(0, 12)}]`)
            project.url = projectURL
            project.state = 'running'
            await project.save()
            this._projects[project.id].state = 'starting'
        })
}

const getStaticFileUrl = async (instance, filePath) => {
    return `http://${instance.id}:2880/flowforge/files/_/${encodeURIComponent(filePath)}`
}

const createMQttTopicAgent = async (broker) => {
    const image = this._app.config.driver.options?.mqttSchemaContainer || `${this._app.config.driver.options?.registry ? this._app.config.driver.options.registry + '/' : ''}flowfuse/mqtt-schema-agent`
    const name = `mqtt-schema-agent-${broker.Team.hashid.toLowerCase()}-${broker.hashid.toLowerCase()}`
    const contOptions = {
        Image: image,
        name,
        Env: [],
        Labels: {
            flowforge: 'mqtt-agent'
        },
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        HostConfig: {
            NetworkMode: this._network,
            RestartPolicy: {
                Name: 'unless-stopped'
            },
            NanoCpus: ((10 / 100) * (10 ** 9)), // 10%
            Memory: (100 * 1024 * 1024) // 100mb
        }
    }

    const { token } = await broker.refreshAuthTokens()
    contOptions.Env.push(`FORGE_TEAM_TOKEN=${token}`)
    contOptions.Env.push(`FORGE_URL=${this._app.config.api_url}`)
    contOptions.Env.push(`FORGE_BROKER_ID=${broker.hashid}`)
    contOptions.Env.push(`FORGE_TEAM_ID=${broker.Team.hashid}`)

    const containerList = await this._docker.listImages()
    let containerFound = false
    let stackName = image
    if (stackName.indexOf(':') === -1) {
        stackName = stackName + ':latest'
    }
    for (const cont of containerList) {
        if (cont.RepoTags.includes(stackName)) {
            containerFound = true
            break
        }
    }
    if (!containerFound) {
        this._app.log.info(`Container for MQTT Schema Agent not found, pulling ${stackName}`)
        try {
            await new Promise((resolve, reject) => {
                this._docker.pull(stackName, (err, stream) => {
                    if (!err) {
                        this._docker.modem.followProgress(stream, onFinished)
                        function onFinished (err, output) {
                            if (!err) {
                                resolve(true)
                                return
                            }
                            reject(err)
                        }
                    } else {
                        reject(err)
                    }
                })
            })
        } catch (err) {
            this._app.log.debug(`Error pulling image ${stackName} ${err.message}`)
        }
    }
    const container = await this._docker.createContainer(contOptions)
    await container.start()
}

/**
 * Docker Container driver
 *
 * Handles the creation and deletation of containers to back Projects
 *
 * This driver creates Projects backed by Docker
 *
 * @module docker
 * @memberof forge.containers.drivers
 *
 */
module.exports = {
    /**
     * Initialises this driver
     * @param {string} app - the Vue application
     * @param {object} options - A set of configuration options for the driver
     * @return {forge.containers.ProjectArguments}
     */
    init: async (app, options) => {
        this._app = app
        this._projects = {}
        this._docker = new Docker({
            socketPath: app.config.driver.options?.socket || '/var/run/docker.sock'
        })
        this._options = options

        if (!options.registry) {
            options.registry = app.config.driver.options?.registry || '' // use docker hub
        }

        const networks = await this._docker.listNetworks({ filters: { label: ['com.docker.compose.network=flowforge'] } })
        if (networks.length > 1) {
            const filteredNetworks = []
            for (let j = 0; j < networks.length; j++) {
                const details = await this._docker.getNetwork(networks[j].Id).inspect()
                const containers = Object.keys(details.Containers)
                for (let i = 0; i < containers.length; i++) {
                    // console.log(containers[i])
                    if (containers[i].startsWith(process.env.HOSTNAME)) {
                        filteredNetworks.push(networks[j])
                    }
                }
            }
            // console.log(JSON.stringify(filteredNetworks, null, 2))
            if (filteredNetworks[0]) {
                this._app.log.info(`[docker] using network ${filteredNetworks[0].Name}`)
                this._network = filteredNetworks[0].Name
            } else {
                this._app.log.info('[docker] unable to find network')
                process.exit(-9)
            }
        } else if (networks.length === 1) {
            this._app.log.info(`[docker] using network ${networks[0].Name}`)
            this._network = networks[0].Name
        } else {
            this._app.log.info('[docker] unable to find network')
            process.exit(-9)
        }

        // Get a list of all projects - with the absolute minimum of fields returned
        const projects = await app.db.models.Project.findAll({
            attributes: [
                'id',
                'state',
                'ProjectStackId',
                'TeamId'
            ]
        })
        projects.forEach(async (project) => {
            if (this._projects[project.id] === undefined) {
                this._projects[project.id] = {
                    state: 'unknown'
                }
            }
        })

        this._initialCheckTimeout = setTimeout(async () => {
            this._app.log.debug('[docker] Restarting projects')
            projects.forEach(async (project) => {
                try {
                    if (project.state === 'suspended') {
                        // Do not restart suspended projects
                        return
                    }
                    let container
                    try {
                        container = await this._docker.listContainers({
                            all: true,
                            filters: {
                                name: [project.id]
                            }
                        })
                        if (container[0]) {
                            container = await this._docker.getContainer(container[0].Id)
                        } else {
                            container = undefined
                        }
                    } catch (err) {
                        console.log(err)
                    }
                    if (container) {
                        const state = await container.inspect()
                        if (!state.State.Running) {
                            this._projects[project.id].state = 'starting'
                            this._app.log.debug(`[docker] Project ${project.id} - restarting container [${container.id.substring(0, 12)}]`)
                            // need to restart existing container
                            container.start().then(() => {
                                this._projects[project.id].state = 'started'
                            })
                        } else {
                            this._app.log.debug(`[docker] Project ${project.id} - already running container [${container.id.substring(0, 12)}]`)
                            this._projects[project.id].state = 'started'
                        }
                    } else {
                        this._app.log.debug(`[docker] Project ${project.id} - recreating container`)
                        const fullProject = await this._app.db.models.Project.byId(project.id)
                        // need to create
                        await createContainer(fullProject, this._options.domain)
                    }
                } catch (err) {
                    this._app.log.error(`[docker] Project ${project.id} - error resuming project: ${err.stack}`)
                }
            })

            if (this._app.db.models.BrokerCredentials) {
                const brokers = await this._app.db.models.BrokerCredentials.findAll({
                    include: [{ model: this._app.db.models.Team }]
                })

                brokers.forEach(async (broker) => {
                    if (broker.Team) {
                        if (broker.state === 'running') {
                            const name = `mqtt-schema-agent-${broker.Team.hashid.toLowerCase()}-${broker.hashid.toLowerCase()}`
                            this._app.log.info(`[docker] Testing MQTT Agent ${name} container exists`)
                            this._app.log.debug(`${name}`)
                            let container
                            try {
                                container = await this._docker.listContainers({
                                    all: true,
                                    filters: {
                                        name: [name]
                                    }
                                })
                                if (container[0]) {
                                    container = await this._docker.getContainer(container[0].Id)
                                } else {
                                    container = undefined
                                }
                                if (container) {
                                    const state = await container.inspect()
                                    if (!state.State.Running) {
                                        this._app.log.info(`[docker] MQTT Agent ${name} - restarting container [${container.id.substring(0, 12)}]`)
                                        await container.start()
                                    } else {
                                        this._app.log.info(`[docker] MQTT Agent ${name} - already running container [${container.id.substring(0, 12)}]`)
                                    }
                                } else {
                                    this._app.log.info(`[docker] MQTT Agent ${name} - recreating container`)
                                    createMQttTopicAgent(broker)
                                }
                            } catch (err) {
                                console.log(err)
                            }
                        }
                    }
                })
            }
        }, 1000)

        return {
            stack: {
                properties: {
                    cpu: {
                        label: 'CPU Cores (in 1/100th units)',
                        validate: '^([1-9][0-9]{0,2}|1000)$',
                        invalidMessage: 'Invalid value - must be a number between 1 and 1000, where 100 represents 1 CPU core',
                        description: 'Defines the CPU resources each Project should receive, in units of 1/100th of a CPU core. 100 equates to 1 CPU core'
                    },
                    memory: {
                        label: 'Memory (MB)',
                        validate: '^[1-9]\\d+$',
                        invalidMessage: 'Invalid value - must be a number',
                        description: 'How much memory the container for each Project will be granted, recommended value 256'
                    },
                    container: {
                        label: 'Container Location',
                        // taken from https://stackoverflow.com/a/62964157
                        validate: '^(([a-z0-9]|[a-z0-9][a-z0-9\\-]*[a-z0-9])\\.)*([a-z0-9]|[a-z0-9][a-z0-9\\-]*[a-z0-9])(:[0-9]+\\/)?(?:[0-9a-z-]+[/@])(?:([0-9a-z-]+))[/@]?(?:([0-9a-z-]+))?(?::[a-z0-9\\.-]+)?$',
                        invalidMessage: 'Invalid value - must be a Docker image',
                        description: 'Container image location, can include a tag'
                    }
                }
            }
        }
    },
    /**
     * Start a Project
     * @param {*}  - id for the project
     * @return {forge.containers.Project}
     */
    start: async (project) => {
        this._projects[project.id] = {
            state: 'starting'
        }
        const rs = createContainer(project, this._options.domain)
        return rs
    },
    /**
     * Stops the container and removes it
     * @param {*} project
     */
    stop: async (project) => {
        // There is no difference in docker between suspending and stopping the container
        // as we have no additional state to maintain
        const container = await this._docker.getContainer(project.id)
        this._projects[project.id].state = 'suspended'
        await container.stop()

        // We remove the container even though this is only a stop, so that a
        // restart can rebuild with a different container image if needed.
        // An alternative would be to spot the required image had changed on
        // start, and do the remove/create/start at that point in time.
        await container.remove()
    },
    /**
     * Removes a Project
     * @param {string} id - id of project to remove
     * @return {Object}
     */
    remove: async (project) => {
        if (this._projects[project.id].state !== 'suspended') {
            try {
                const container = await this._docker.getContainer(project.id)
                await container.stop()
                await container.remove()
            } catch (err) {}
        }
        if (this._app.config.driver.options?.storage?.enabled) {
            // need to be sure we have permission to delete the dir and it's contents?
            try {
                // This is better and assumes that directory is mounted on `/opt/storage`
                const projectPersistentPath = path.join('/opt/persistent-storage', project.id)
                rmSync(projectPersistentPath, { recursive: true, force: true })
            } catch (err) {
                this._app.log.error(`[docker] Project ${project.id} - error deleting persistent storage: ${err.stack}`)
            }
        }
        delete this._projects[project.id]
    },
    /**
     * Retrieves details of a project's container
     * @param {string} id - id of project to query
     * @return {Object}
     */
    details: async (project) => {
        if (this._projects[project.id] === undefined) {
            return { state: 'unknown' }
        }
        if (this._projects[project.id].state === 'suspended') {
            // We should only poll the launcher if we think it is running.
            // Otherwise, return our cached state
            return {
                state: this._projects[project.id].state
            }
        }
        const containers = await this._docker.listContainers({})
        let found = false
        let response
        for (let index = 0; index < containers.length; index++) {
            const container = containers[index]
            if (container.Names[0].endsWith(project.id)) {
                found = true
                const infoURL = 'http://' + project.id + ':2880/flowforge/info'
                try {
                    response = await got.get(infoURL, {
                        timeout: {
                            request: 500
                        }
                    }).json()
                    this._projects[project.id].state = 'running'
                    break
                } catch (err) {
                    response = {
                        id: project.id,
                        state: 'starting',
                        meta: {}
                    }
                }
            }
        }
        if (found) {
            return response
        } else {
            return {
                id: project.id,
                state: 'starting',
                meta: {}
            }
        }
        // const infoURL = 'http://' + project.id + ':2880/flowforge/info'
        // try {
        //     const info = JSON.parse((await got.get(infoURL),{
        //         timeout: {
        //             request: 500
        //         }
        //     }).body)
        //     this._projects[project.id].state = 'running'
        //     return info
        // } catch (err) {
        //     // TODO
        //     // return
        //     return {
        //         id: project.id,
        //         state: 'starting'
        //     }
        // }
    },
    /**
     * Returns the settings for the project
     */
    settings: async (project) => {
        // let project = await this._app.db.models.DockerProject.byId(id)
        // const projectSettings = await project.getAllSettings()
        // let options = JSON.parse(project.options)
        const settings = {}
        settings.projectID = project.id
        settings.port = 1880
        settings.rootDir = '/'
        settings.userDir = 'data'

        return settings
    },
    /**
     * Starts the flows
     * @param {string} id - id of project to start
     * @return {forge.Status}
     */
    startFlows: async (project) => {
        if (this._projects[project.id] === undefined) {
            return { state: 'unknown' }
        }
        await got.post('http://' + project.id + ':2880/flowforge/command', {
            json: {
                cmd: 'start'
            }
        })
    },
    /**
     * Stops the flows
     * @param {string} id - id of project to stop
     * @return {forge.Status}
     */
    stopFlows: async (project) => {
        if (this._projects[project.id] === undefined) {
            return { state: 'unknown' }
        }
        await got.post('http://' + project.id + ':2880/flowforge/command', {
            json: {
                cmd: 'stop'
            }
        })
    },
    /**
     * Restarts the flows
     * @param {string} id - id of project to restart
     * @return {forge.Status}
     */
    restartFlows: async (project) => {
        if (this._projects[project.id] === undefined) {
            return { state: 'unknown' }
        }
        await got.post('http://' + project.id + ':2880/flowforge/command', {
            json: {
                cmd: 'restart'
            }
        })
    },
    /**
   * Logout Node-RED instance
   * @param {Project} project - the project model instance
   * @param {string} token - the node-red token to revoke
   * @return {forge.Status}
   */
    revokeUserToken: async (project, token) => { // logout:nodered(step-3)
        try {
            this._app.log.debug(`[docker] Project ${project.id} - logging out node-red instance`)
            await got.post('http://' + project.id + ':2880/flowforge/command', { // logout:nodered(step-4)
                json: {
                    cmd: 'logout',
                    token
                }
            })
        } catch (error) {
            this._app.log.error(`[docker] Project ${project.id} - error in 'revokeUserToken': ${error.stack}`)
        }
    },
    logs: async (project) => {
        if (this._projects[project.id] === undefined) {
            return { state: 'unknown' }
        }
        return await got.get('http://' + project.id + ':2880/flowforge/logs').json()
    },
    /**
     * Shutdown Driver
     */
    shutdown: async () => {
        clearTimeout(this._initialCheckTimeout)
    },
    /**
     * getDefaultStackProperties
     */
    getDefaultStackProperties: () => {
        // need to work out what the right container tag is
        const properties = {
            cpu: 10,
            memory: 256,
            container: 'flowfuse/node-red:latest',
            ...this._app.config.driver.options?.default_stack
        }

        return properties
    },

    // Static Assets API
    listFiles: async (instance, filePath) => {
        const fileUrl = await getStaticFileUrl(instance, filePath)
        try {
            return got.get(fileUrl).json()
        } catch (err) {
            err.statusCode = err.response.statusCode
            throw err
        }
    },

    updateFile: async (instance, filePath, update) => {
        const fileUrl = await getStaticFileUrl(instance, filePath)
        try {
            return got.put(fileUrl, {
                json: update
            })
        } catch (err) {
            err.statusCode = err.response.statusCode
            throw err
        }
    },

    deleteFile: async (instance, filePath) => {
        const fileUrl = await getStaticFileUrl(instance, filePath)
        try {
            return got.delete(fileUrl)
        } catch (err) {
            err.statusCode = err.response.statusCode
            throw err
        }
    },
    createDirectory: async (instance, filePath, directoryName) => {
        const fileUrl = await getStaticFileUrl(instance, filePath)
        try {
            return got.post(fileUrl, {
                json: { path: directoryName }
            })
        } catch (err) {
            err.statusCode = err.response.statusCode
            throw err
        }
    },
    uploadFile: async (instance, filePath, fileBuffer) => {
        const form = new FormData()
        form.append('file', fileBuffer, { filename: filePath })
        const fileUrl = await getStaticFileUrl(instance, filePath)
        try {
            return got.post(fileUrl, {
                body: form
            })
        } catch (err) {
            err.statusCode = err.response.statusCode
            throw err
        }
    },

    // Broker Agent
    startBrokerAgent: async (broker) => {
        createMQttTopicAgent(broker)
    },
    stopBrokerAgent: async (broker) => {
        const name = `mqtt-schema-agent-${broker.Team.hashid.toLowerCase()}-${broker.hashid.toLowerCase()}`
        try {
            const container = await this._docker.getContainer(name)
            await container.stop()
            await container.remove()
        } catch (err) {
            console.log(err)
        }
    },
    getBrokerAgentState: async (broker) => {
        const name = `mqtt-schema-agent-${broker.Team.hashid.toLowerCase()}-${broker.hashid.toLowerCase()}`
        try {
            const status = await got.get(`http://${name}:3500/api/v1/status`).json()
            return status
        } catch (err) {
            return { error: 'error_getting_status', message: err.toString() }
        }
    },
    sendBrokerAgentCommand: async (broker, command) => {
        const name = `mqtt-schema-agent-${broker.Team.hashid.toLowerCase()}-${broker.hashid.toLowerCase()}`
        if (command === 'start' || command === 'restart') {
            try {
                await got.post(`http://${name}:3500/api/v1/commands/start`)
            } catch (err) {

            }
        } else if (command === 'stop') {
            try {
                await got.post(`http://${name}:3500/api/v1/commands/stop`)
            } catch (err) {

            }
        }
    }
}
