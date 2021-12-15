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

        // require('./models/Project')(app.db)

        // let projects = await this._app.db.models.DockerProject.findAll()
        let projects = await this._app.db.models.Project.findAll()
        projects.forEach(async (project) => {
            const projectSettings = await project.getAllSettings();
            // let forgeProject = await this._app.db.models.Project.byId(project.id);
            if (project) {
                let container
                try {
                    container = await this._docker.getContainer(project.id)
                } catch (err) {

                }
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
                    let name = project.name
                    this._app.containers._createContainer(project.id,
                        {},//JSON.parse(project.options),
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
    create: async (project, options) => {
        console.log("creating ", project.id)
        // console.log(options)
        // console.log("---")

        return await this._app.containers._createContainer(project, options, this._options.domain, this._options.containers[options.type])
    },
    /**
     * Removes a Project
     * @param {string} id - id of project to remove
     * @return {Object}
     */
    remove: async (project) => {
        console.log("removing ", project.id)
        try {
            // let forgeProject = await this._app.db.models.Project.byId(id);
            let container = await this._docker.getContainer(project.id)//forgeProject.name);
            await container.stop()
            await container.remove()
            // let project = await this._app.db.models.DockerProject.byId(id)
            // await project.destroy()
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
    details: async (project) => {
        try {
            // let forgeProject = await this._app.db.models.Project.byId(id);
            let container = await this._docker.getContainer(project.id)//forgeProject.name);
            //console.log(container);
            let inspect = await container.inspect()
            return Promise.resolve({
                id: id,
                state: inspect.State.Running ? "running" : "stopped",
                meta: container
            })
        } catch (err) {
            console.log(err)
            return Promise.resolve({error: err})
        }
    },
    /**
     * Returns the settings for the project
     */
    settings: async (project) => {
      // let project = await this._app.db.models.DockerProject.byId(id)
      const projectSettings = await project.getAllSettings()
      //let options = JSON.parse(project.options)
      let settings = {}
      settings.projectID = project.id
      settings.port = 1880
      settings.rootDir = "/"
      settings.userDir = "data"
      settings.baseURL = project.url
      settings.forgeURL = process.env["BASE_URL"]

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
    start: async (project) => {
        // try {
        //     let container = await this._docker.getContainer(project.id);
        //     container.start()
        // } catch (err) {

        // }

        await got.post("http://" + project.id +  ":2880/flowforge/command",{
          json: {
            cmd: "start"
          }
        })

        project.state = "starting"
        project.save()

        return {status: "okey"}
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

        await got.post("http://" + project.id +  ":2880/flowforge/command",{
          json: {
            cmd: "stop"
          }
        })
        project.state = "stopped";
        project.save()
        return Promise.resolve({status: "okay"})
    },
    /**
     * Restarts a Project's container
     * @param {string} id - id of project to restart
     * @return {forge.Status}
     */
    restart: async (project) => {
        await got.post("http://" + project.id +  ":2880/flowforge/command",{
          json: {
            cmd: "restart"
          }
        })

        return {state: "okay"}
    },
    logs: async (project) => {
        let result = await got.get("http://" + project.id + ":2880/flowforge/logs").json()
        return result
    },
    _createContainer: async (project, options, domain, image) => {

        let contOptions = {
            Image: image,
            name: project.id, //options.name,
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
        let projectURL = `http://${project.name}.${this._options.domain}`

        authTokens = await project.refreshAuthTokens()

        //AuthProvider
        contOptions.Env.push("FORGE_CLIENT_ID="+authTokens.clientID);
        contOptions.Env.push("FORGE_CLIENT_SECRET="+authTokens.clientSecret);
        //TODO this needs to come from a central point
        contOptions.Env.push("FORGE_URL="+process.env["BASE_URL"]);
        contOptions.Env.push(`BASE_URL=${projectURL}`);
        //Only if we are using nginx ingress proxy
        contOptions.Env.push(`VIRTUAL_HOST=${options.name}.${domain}`);
        contOptions.Env.push(`VIRTUAL_PORT=1880`);
        //httpStorage settings
        contOptions.Env.push(`FORGE_PROJECT_ID=${project.id}`)
        contOptions.Env.push(`FORGE_PROJECT_TOKEN=${authTokens.token}`)
        // contOptions.Env.push(`FORGE_STORAGE_URL=${options.storageURL}`)
        // contOptions.Env.push(`FORGE_STORAGE_TOKEN=${options.projectToken || "ABCD"}`)
        // contOptions.Env.push(`FORGE_AUDIT_URL=${process.env["BASE_URL"] + "/logging"}`);
        // contOptions.Env.push(`FORGE_AUDIT_TOKEN=${options.projectToken || "ABCD"}`);

        try {
            let container = await this._docker.createContainer(contOptions);
            // let project = await this._app.db.models.DockerProject.create({
            //     id: id,
            //     url: projectURL,
            //     state: "starting",
            //     options: options ? JSON.stringify(options) : '{}'
            // })
            container.start()
            .then(() => {
                project.state = "running";
                project.save();
            })
            .catch(err => {
                console.log( err)
            });

            console.log("all good")

            return {
                id: project.id, 
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