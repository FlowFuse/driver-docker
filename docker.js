const got = require('got')
const Docker = require('dockerode')

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
        this._docker = new Docker({
            socketPath: app.config.driver.options?.socket || '/var/run/docker.sock'
        })
        this._options = options

        if (!options.registry) {
            options.registry = app.config.driver.options?.registry || '' // use docker hub
        }

        // let projects = await this._app.db.models.DockerProject.findAll()
        const projects = await this._app.db.models.Project.findAll()
        projects.forEach(async (project) => {
            // const projectSettings = await project.getAllSettings();
            // let forgeProject = await this._app.db.models.Project.byId(project.id);
            if (project) {
                let container
                try {
                    container = await this._docker.listContainers({ filter: `name=${project.id}` })
                    if (container[0]) {
                        container = await this._docker.getContainer(container[0].Id)
                    } else {
                        container = undefined
                    }
                } catch (err) {
                    console.log('Container not found')
                }
                if (container) {
                    const state = await container.inspect()
                    if (!state.State.Running) {
                        if (project.state === 'running') {
                            // need to restart existing container
                            container.start()
                        }
                    }
                } else {
                    // need to create
                    this._app.containers._createContainer(project,
                        {}, // JSON.parse(project.options),
                        this._options.domain,
                        this._options.containers[project.type]
                    )
                }
            }
        })

        return {}
    },
    /**
     * Create a new Project
     * @param {string} id - id for the project
     * @param {forge.containers.Options} options - options for the project
     * @return {forge.containers.Project}
     */
    create: async (project, options) => {
        // console.log(options)
        // console.log("---")
        return await this._app.containers._createContainer(project, options, this._options.domain, this._options.containers[project.type])
    },
    /**
     * Removes a Project
     * @param {string} id - id of project to remove
     * @return {Object}
     */
    remove: async (project) => {
        console.log('removing ', project.id)
        try {
            // let forgeProject = await this._app.db.models.Project.byId(id);
            const container = await this._docker.getContainer(project.id)
            await container.stop()
            await container.remove()
            // let project = await this._app.db.models.DockerProject.byId(id)
            // await project.destroy()
            return { status: 'okay' }
        } catch (err) {
            console.log(err)
            return { error: err }
        }
    },
    /**
     * Retrieves details of a project's container
     * @param {string} id - id of project to query
     * @return {Object}
     */
    details: async (project) => {
        const infoURL = 'http://' + project.id + ':2880/flowforge/info'
        try {
            const info = JSON.parse((await got.get(infoURL)).body)
            return info
        } catch (err) {
            // TODO
            // return
        }

        // try {
        //     // let forgeProject = await this._app.db.models.Project.byId(id);
        //     let container = await this._docker.getContainer(project.id)//forgeProject.name);
        //     //console.log(container);
        //     let inspect = await container.inspect()
        //     return Promise.resolve({
        //         id: project.id,
        //         state: inspect.State.Running ? "running" : "stopped",
        //         meta: container
        //     })
        // } catch (err) {
        //     console.log(err)
        //     return Promise.resolve({error: err})
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
        settings.baseURL = project.url
        settings.forgeURL = this._app.config.base_url

        return settings
    },
    /**
     * Lists all containers
     * @param {string} filter - rules to filter the containers
     * @return {Object}
     */
    list: async (filter) => {
        const containers = await this._docker.listContainers({ all: true })
        // console.log(containers)
        return containers.map(c => { return c.Names[0].substring(1) })
    },
    /**
     * Starts a Project's container
     * @param {string} id - id of project to start
     * @return {forge.Status}
     */
    start: async (project) => {
        // try {
        //     let container = await this._docker.getContainer(project.id);
        //     container.start()
        // } catch (err) {

        // }

        await got.post('http://' + project.id + ':2880/flowforge/command', {
            json: {
                cmd: 'start'
            }
        })

        project.state = 'starting'
        project.save()

        return { status: 'okey' }
    },
    /**
     * Stops a Proejct's container
     * @param {string} id - id of project to stop
     * @return {forge.Status}
     */
    stop: async (project) => {
        // try {
        //     let container = await this._docker.getContainer(project.id);
        //     container.stop()
        // } catch (err) {

        // }

        await got.post('http://' + project.id + ':2880/flowforge/command', {
            json: {
                cmd: 'stop'
            }
        })
        project.state = 'stopped'
        project.save()
        return Promise.resolve({ status: 'okay' })
    },
    /**
     * Restarts a Project's container
     * @param {string} id - id of project to restart
     * @return {forge.Status}
     */
    restart: async (project) => {
        await got.post('http://' + project.id + ':2880/flowforge/command', {
            json: {
                cmd: 'restart'
            }
        })

        return { state: 'okay' }
    },
    logs: async (project) => {
        try {
            const result = await got.get('http://' + project.id + ':2880/flowforge/logs').json()
            return result
        } catch (err) {
            console.log(err)
            return ''
        }
    },
    _createContainer: async (project, options, domain, image) => {
        const networks = await this._docker.listNetworks({ filters: { label: ['com.docker.compose.network=flowforge'] } })

        if (options.registry) {
            image = options.registry + '/' + image
        }
        const contOptions = {
            Image: image,
            name: project.id, // options.name,
            Env: [],
            Labels: {},
            AttachStdin: false,
            AttachStdout: false,
            AttachStderr: false,
            HostConfig: {
                NetworkMode: networks[0].Name
            }
        }
        if (options.env) {
            Object.keys(options.env).forEach(k => {
                if (k) {
                    contOptions.Env.push(k + '=' + options.env[k])
                }
            })
        }

        // TODO http/https needs to be dynamic (or we just enforce https?)
        // and port number
        const projectURL = `http://${project.name}.${this._options.domain}`

        const authTokens = await project.refreshAuthTokens()

        // AuthProvider
        contOptions.Env.push('FORGE_CLIENT_ID=' + authTokens.clientID)
        contOptions.Env.push('FORGE_CLIENT_SECRET=' + authTokens.clientSecret)
        // TODO this needs to come from a central point
        contOptions.Env.push('FORGE_URL=' + this._app.config.api_url)
        contOptions.Env.push(`BASE_URL=${projectURL}`)
        // Only if we are using nginx ingress proxy
        contOptions.Env.push(`VIRTUAL_HOST=${project.name}.${domain}`)
        contOptions.Env.push('VIRTUAL_PORT=1880')
        // httpStorage settings
        contOptions.Env.push(`FORGE_PROJECT_ID=${project.id}`)
        contOptions.Env.push(`FORGE_PROJECT_TOKEN=${authTokens.token}`)

        try {
            const container = await this._docker.createContainer(contOptions)

            project.url = projectURL
            project.save()

            container.start()
                .then(() => {
                    project.state = 'running'
                    project.save()
                })
                .catch(err => {
                    console.log(err)
                })

            return {
                id: project.id,
                status: 'okay',
                url: projectURL,
                meta: container
            }
        } catch (err) {
            console.log('error:', err)
            return { error: err }
        }
    }
}
