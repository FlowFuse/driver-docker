const Docker = require('dockerode');

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
            socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
        })
        this._options = options

        require('./models/Project')(app.db)

        let projects = await this._app.db.models.DockerProject.findAll()
        projects.forEach(async (project) => {
            let forgeProject = await this._app.db.models.Project.byId(project.id);
            if (forgeProject) {
                let container = await this._docker.getContainer(forgeProject.name)
                if (container) {
                    let state = await container.inspect()
                    if (!state.State.Running) {
                        if (project.state == 'running') {
                            //need to restart existing container
                            container.start()
                        }
                    } 
                } else {
                    //need to create
                    let p = await this._app.dn.models.Project.byId(project.id)
                    let name = p.name
                    this._app.containers._createContainer(project.id,
                        JSON.parse(project.options),
                        this._options.domain, 
                        this._options.containers[project.type]
                    );
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
    create: async (id, options) => {
        console.log("creating ", id)
        // console.log(options)
        // console.log("---")

        return await this._app.containers._createContainer(id, options, this._options.domain, this._options.containers[options.type])
    },
    /**
     * Removes a Project
     * @param {string} id - id of project to remove
     * @return {Object}
     */
    remove: async (id) => {
        console.log("removing ", id)
        try {
            let forgeProject = await this._app.db.models.Project.byId(id);
            let container = await this._docker.getContainer(forgeProject.name);
            await container.stop()
            await container.remove()
            let project = await this._app.db.models.DockerProject.byId(id)
            await project.destroy()
            return {status: "okay"}
        } catch (err) {
            console.log(err)
            return {error: err}
        }
    },
    /**
     * Retrieves details of a project's container
     * @param {string} id - id of project to query
     * @return {Object} 
     */
    details: async (id) => {
        try {
            let container = await this._docker.getContainer(id);
            return container
        } catch (err) {
            return {error: err}
        }
    },
    /**
     * Returns the settings for the project
     */
    settings: async (id) => {
      let project = await this._app.db.models.DockerProject.byId(id)
      let options = JSON.parse(project.options)
      let settings = {}
      settings.port = 1880
      settings.rootDir = "/"
      settings.userDir = "data"
      settings.settings = "module.exports = { "
        + "flowFile: 'flows.json', " 
        + "flowFilePretty: true, "
        + "adminAuth: require('@flowforge/nr-auth')({ "
        + " baseURL: 'http://localhost:" + project.port + "', "
        + " forgeURL: '" + process.env["BASE_URL"] + "', "
        + " clientID: '" + options.clientID + "', "
        + " clientSecret: '" + options.clientSecret + "' "
        + " }),"
        + "storageModule: require('@flowforge/nr-storage'), "
        + "httpStorage: { "
        + "projectID: '" + id + "', "
        + "baseURL: '" + options.storageURL + "', " 
        + "token: '" + options.projectToken + "', "
        + " }, "
        + "logging: { "
        + "console: { level: 'info', metric: false, audit: false }, "
        + "auditLogger: { "
        + "level: 'off', audit: true, handler: require('@flowforge/nr-audit-logger'), "
        + "loggingURL: '" + options.auditURL + "', "
        + "projectID: '" + id + "', "
        + "token: '" + options.projectToken + "' "
        + " }"
        + "}, "
        + "editorTheme: { page: {title: 'FlowForge'}, header: {title: 'FlowForge'} } "
        + "}"

      return settings
    },
    /**
     * Lists all containers
     * @param {string} filter - rules to filter the containers
     * @return {Object}
     */
    list: async (filter) => {
        let containers = await this._docker.listContainers({all: true})
        //console.log(containers)
        return containers.map(c => { return c.Names[0].substring(1)})
    },
    /**
     * Starts a Project's container
     * @param {string} id - id of project to start
     * @return {forge.Status}
     */
    start: async (id) => {
        try {
            let container = await this._docker.getContainer(id);
            container.start()
        } catch (err) {

        }
    },
    /**
     * Stops a Proejct's container
     * @param {string} id - id of project to stop
     * @return {forge.Status}
     */
    stop: async (id) => {
        try {
            let container = await this._docker.getContainer(id);
            container.stop()
        } catch (err) {

        }
    },
    /**
     * Restarts a Project's container
     * @param {string} id - id of project to restart
     * @return {forge.Status}
     */
    restart: async (id) => {
        await this.stop(id);
        return await this.start(id);
    },
    _createContainer: async (id, options, domain, image) => {

        let contOptions = {
            Image: image,
            name: options.name,
            Env: [],
            Labels: {},
            AttachStdin: false,
            AttachStdout: false,
            AttachStderr: false,
            HostConfig: {
                NetworkMode: "internal"
            }
        }
        if (options.env) {
            Object.keys(options.env).forEach(k=>{
                if (k) {
                    contOptions.Env.push(k+"="+options.env[k])
                }
            })
        }

        //TODO http/https needs to be dynamic (or we just enforce https?)
        //and port number
        let projectURL = `http://${options.name}.${this._options.domain}`

        //AuthProvider
        contOptions.Env.push("FORGE_CLIENT_ID="+options.clientID);
        contOptions.Env.push("FORGE_CLIENT_SECRET="+options.clientSecret);
        //TODO this needs to come from a central point
        contOptions.Env.push("FORGE_URL="+process.env["BASE_URL"]);
        contOptions.Env.push(`BASE_URL=${projectURL}`);
        //Only if we are using nginx ingress proxy
        contOptions.Env.push(`VIRTUAL_HOST=${options.name}.${domain}`);
        contOptions.Env.push(`VIRTUAL_PORT=1880`);
        //httpStorage settings
        contOptions.Env.push(`FORGE_PROJECT_ID=${id}`)
        contOptions.Env.push(`FORGE_PROJECT_TOKEN=${options.projectToken}`)
        contOptions.Env.push(`FORGE_STORAGE_URL=${options.storageURL}`)
        contOptions.Env.push(`FORGE_STORAGE_TOKEN=${options.projectToken || "ABCD"}`)
        contOptions.Env.push(`FORGE_AUDIT_URL=${process.env["BASE_URL"] + "/logging"}`);
        contOptions.Env.push(`FORGE_AUDIT_TOKEN=${options.projectToken || "ABCD"}`);

        try {
            let container = await this._docker.createContainer(contOptions);
            let project = await this._app.db.models.DockerProject.create({
                id: id,
                url: projectURL,
                state: "starting",
                options: options ? JSON.stringify(options) : '{}'
            })
            container.start()
            .then(() => {
                project.state = "running";
                project.save();
            });

            console.log("all good")

            return {
                id: id, 
                status: "okay", 
                url: projectURL,
                meta: container
            };
        } catch(err) {
            console.log("error:", err)
            return {error: err}
        }
    }
}