const got = require('got')
const Docker = require('dockerode')

const createContainer = async (project, domain) => {
    const networks = await this._docker.listNetworks({ filters: { label: ['com.docker.compose.network=flowforge'] } })
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
            NetworkMode: networks[0].Name
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

    if (this._options?.logPassthrough) {
        contOptions.Env.push('FORGE_LOG_PASSTHROUGH=true')
    }

    if (this._app.config.driver.options?.privateCA) {
        contOptions.Binds = [
            `${this._app.config.driver.options.privateCA}:/usr/local/ssl-certs/chain.pem`
        ]
        contOptions.Env.push('NODE_EXTRA_CA_CERTS=/usr/local/ssl-certs/chain.pem')
    }

    const containerList = await this._docker.listImages()
    let containerFound = false
    for (const cont of containerList) {
        if (cont.RepoTags.includes(stack.container)) {
            containerFound = true
            break
        }
    }

    if (!containerFound) {
        this._app.log.info(`Container for stack ${stack.name} not found, pulling ${stack.container}`)
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

        this._initialCheckTimeout = setTimeout(() => {
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
            container: 'flowfuse/node-red',
            ...this._app.config.driver.options?.default_stack
        }

        return properties
    }
}
