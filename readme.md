> jenkins-cli - jenkins command line interface

<p align="center">
  <img src="https://cdn.rawgit.com/marionebl/jenkins-cli/master/jenkins-cli.svg" width="300" />
</p>

## Installation
```shell
# Install it from npm
npm install -g jenkins-cli
```

### Usage
`jenkins-cli` exposes a command line interface
```shell
jenkins usage:
 -    pull - pull jenkins configuration for [project]
 -    push - push jenkins configuration for [project]
 -    build - trigger build for [project]
 -    watch - watch current build for [project]
 -    list - list available projects
 -    help - print this help
```

## Configuration
`jenkins-cli` can be configured via `package.json` in `config.jenkins`, via `.jenkinsrc` and `.env` files. All configuration keys can be overridden via cli, by specifying `--${key}=${value}`.

### .jenkinsrc
```js
{
  "host": "https://jenkins-host.tld",   // jenkins instance to use
  "group": "jenkins-group",             // jenkins group to use
  "directory": "configuration/jenkins", // directory to save project config.xmls to
  "default": "jenkins-cli",             // project name to default to
  "projects": [                         // project names to execute subcommands for
    "jenkins-cli",
    "jenkins-cli-publish",
    "jenkins-cli-test"
  ]
}
```

### .env
```
# Use .env to save credentials for later use
# It is recommended to place this in .gitignore
JENKINS_USERNAME=[YOUR-USERNAME]
JENKINS_PASSWORD=[YOUR-PASSWORD]
```

### package.json
```json
{
  "name": "jenkins-cli",
  "config": {
    "jenkins": {
        "host": "https://jenkins-host.tld",
        "group": "jenkins-group",
        "directory": "configuration/jenkins",
        "default": "jenkins-cli",
        "projects": [
          "jenkins-cli",
          "jenkins-cli-publish",
          "jenkins-cli-test"
        ]
      }
    }
  }
}
```
---
Copyright 2016 by [Mario Nebl](https://github.com/marionebl) and [contributors](./graphs/contributors). Released under the [MIT license]('./license.md'). The jenkins logo is released under the [Creative Commons Attribution-ShareAlike 3.0 Unported License](http://creativecommons.org/licenses/by-sa/3.0/) and created by the [jenkins project](https://wiki.jenkins-ci.org/display/JENKINS/Logo)
