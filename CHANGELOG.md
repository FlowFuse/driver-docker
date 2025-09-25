#### 2.22.0: Release

 - Bump JS-DevTools/npm-publish from 3.1.1 to 4.0.0 (#148)
 - add team broker mqtt agent support (#147) @hardillb
 - Bump JS-DevTools/npm-publish from 4.0.0 to 4.0.1 (#149) @app/dependabot

#### 2.21.2: Release

 - Bump actions/setup-node from 4.4.0 to 5.0.0 (#145)

#### 2.21.1: Release


#### 2.21.0: Release

 - Bump actions/checkout from 4.2.2 to 5.0.0 (#142)

#### 2.20.0: Release


#### 2.19.1: Release

 - Bump form-data from 4.0.0 to 4.0.4 (#138) @app/dependabot
 - Don't crash on unamed/untagged images (#137) @hardillb

#### 2.19.0: Release


#### 2.18.0: Release

 - Bump tar-fs from 2.1.2 to 2.1.3 (#133) @app/dependabot
 - Add Resources API endpoint (#132) @hardillb

#### 2.17.0: Release

 - Bump actions/setup-node from 4.3.0 to 4.4.0 (#130)

#### 2.16.0: Release

 - chore: fix lint script (#128) @ppawlowski
 - Bump tar-fs and dockerode (#127) @app/dependabot
 - chore: Pin external actions to commit hash (#126) @ppawlowski

#### 2.15.0: Release

 - docs: Remove unused configuration keyfrom README.md (#124) @ppawlowski
 - Mqtt agent support for Docker (#121) @hardillb
 - feat: Use docker volume as persistent storage backend for project instances (#123) @ppawlowski

#### 2.14.1: Release


#### 2.14.0: Release


#### 2.13.0: Release


#### 2.12.0: Release


#### 2.11.0: Release

 - Log the correct Stack Name when pulling image (#116) @hardillb
 - Add "unless-stopped" flag to Instance containers (#115) @hardillb

#### 2.10.0: Release


#### 2.9.0: Release

 - both storage options required (enabled & path) (#111) @hardillb

#### 2.8.0: Release

 - First pass files api for docker (#108) @hardillb
 - Update README.md (#109) @hardillb

#### 2.7.1: Release

 - Fix logPassthrough (#106) @knolleary

#### 2.7.0: Release

 - Persistent storage - Docker (#103) @hardillb
 - Fix LOG_PASSTHROUGH (#104) @hardillb
 - Fix network selection if more than one network labeled 'flowforge' (#102) @hardillb
 - Update release-publish.yml to use NodeJS v18 (#101) @hardillb
 - Bump JS-DevTools/npm-publish from 2 to 3 (#96) @app/dependabot

#### 2.6.0: Release


#### 2.5.0: Release

 - Bump actions/checkout from 1 to 4 (#98) @app/dependabot
 - Bump actions/setup-node from 1 to 4 (#97) @app/dependabot
 - Enable dependabot for github actions (#95) @ppawlowski
 - Fix privateCA mount (#94) @hardillb

#### 2.4.0: Release


#### 2.3.0: Release

 - Only pull stack container if missing (#89) @hardillb

#### 2.2.1: Release

 - Fix loading private CA certs in Instances (#87) @hardillb

#### 2.2.0: Release

 - Pull missing Stack containers on first use (#85) @hardillb
 - Change default stack container (#84) @hardillb

#### 2.1.0: Release

 - Add log passthrough support (#82) @hardillb

#### 2.0.0: Release


#### 1.15.0: Release

 - #3174: Enable Multi-Core CPU Support for Node-RED Projects (#79) @elenaviter
 - Update npm-publish action version to v2 (#78) @ppawlowski
 - Update npm package scope (#77) @knolleary

#### 1.14.0: Release

 - Add support for Private CA (#75) @hardillb

#### 1.13.0: Release

 - Expose cpu/mem limits (#73) @hardillb
 - Update ff references in package.json (#72) @knolleary
 - Reusable workflow reference name change (#71) @ppawlowski

#### 1.12.0: Release


#### 1.11.0: Release

 - Bump word-wrap from 1.2.3 to 1.2.5 (#68) @app/dependabot

#### 1.10.1: Release

 - Fix editor path (#66) @hardillb

#### 1.10.0: Release

 - Chore: Set root flag in eslint (#63) @Pezmc

#### 1.9.0: Release

 - Allow hosting domain to be changed (#60) @hardillb
 - Add package-lock.json (#61) @Pezmc

#### 1.8.0: Release

 - Fix Delete suspended projects (#57) @hardillb

#### 1.7.0: Release


#### 1.6.0: Release


#### 1.5.0: Release


#### 1.4.0: Release


#### 1.3.0: Release


#### 1.2.0: Release


#### 1.1.0: Release

 - Add getDefaultStackProperies (#46) @hardillb
 - Add flags to inhibit TCP/UDP inbound connections (#45) @Steve-Mcl
 - Add guard for deleting suspended projects (#44) @hardillb

#### 1.0.0: Release

 - Add LetsEncypt env var if https enabled
 - Update eslint (#42) @knolleary

#### 0.10.0: Release


#### 0.9.0: Release

 - Use project.safeName (#37) @hardillb

#### 0.8.0: Release

 - Add licenseType to launcher env (#34) @knolleary
 - add env var FORGE_TEAM_ID (#33) @Steve-Mcl
 - Better start up exp 586 (#32) @hardillb
 - Add FORGE_BROKER_* credentials to launcher env (#30) @knolleary

#### 0.7.0: Release

 - Fix log call when revoking Node-RED sessions (#29) @knolleary

#### 0.6.0: Release

 - Map FlowForge logout to nodered auth/revoke (#24) @Steve-Mcl
 - Throw proper errors when actions performed on unknown project (#25) @knolleary
 - Add FORGE_NR_SECRET env if project has credSecret set (#23) @knolleary
 - Add Stack Properties descriptions (#21) @hardillb

#### 0.5.0: Release

#### 0.4.0: Release

 - Update to use new container driver API (#17) @knolleary
 - Fix validator regex for CPU % (#16) @hardillb
 - Update project automation (#18) @knolleary

#### 0.3.0: Release

 - Stop driver setting baseURL/forgeURL (#14) @knolleary
 - Add Stack support (#13) @hardillb
 - Automate npm publish on release (#12) @hardillb

#### 0.2.0: Release

 - Update deps for security issues (#10) @hardillb
 - Add shutdown hook (#9) @hardillb
 - Make project URL schema match base_url (#8) @hardillb
 - Add project workflow automation (#6) @knolleary
