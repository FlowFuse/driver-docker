# FlowFuse Docker Container Driver

FlowFuse driver to create projects as docker containers

## Configuration

In the `flowforge.yml` file

```yaml
...
driver:
  type: docker
  options:
    socket: /tmp/docker.sock
    registry: containers.flowforge.com
    privateCA: /full/path/to/chain.pem
    logPassthrough: true
    storage:
      enabled: true
      path: /opt/flowfuse/storage
```

 - `registry` is the Docker Registry to load Stack Containers from (default: Docker Hub)
 - `socket` is the path to the docker unix domain socket (default: /var/run/docker.sock)
 - `privateCA`: is the fully qualified path to a pem file containing trusted CA cert chain (default: not set)
 - `logPassthrough` Have Node-RED logs printed in JSON format to container stdout (default: false)
 - `storage.enabled` enables mounting a directory into each Node-RED instance as persistence storage (default: false)
 - `storage.path` is the fully qualified path to the root directory for the storage on the host (default: not set)

### Configuration via environment variables

 - `DOCKER_SOCKET` - Path to docker unix domain socket
