#!/usr/bin/env node
const minimist = require('minimist');
const dotenv = require('dotenv');
const _ = require('lodash');
const pkg = require('./package.json');
const chalk = require('chalk');
const path = require('path');
const jenkins = require('jenkins');
const denodeify = require('denodeify');
const singlelog = require('single-line-log');
const moment = require('moment');

// promisified node apis
const writeFile = denodeify(require('fs').writeFile);
const readFile = denodeify(require('fs').readFile);

// Log icons
const fail = chalk.red(' ✖ ');
const warn = chalk.yellow(' ⚠ ');
const wait = chalk.gray(' ⧗ ');
const ok = chalk.bold.grey(' ⇣ ');
const success = chalk.green(' ✔ ');
const bullet = chalk.bold(' - ');
const speech = chalk.bold(' - ');

function getEnvironment(prefix) {
	return Object.keys(process.env)
		.reduce((results, key) => {
			const value = process.env[key];
			const matches = key.indexOf(`${prefix}_`) === 0;
			const name = key.replace(`${prefix}_`, '').toLowerCase();
			const parsed = matches ?
				{[name]: value} :
				{};
			return _.merge({}, results, parsed);
		}, {});
}

function writeProjects(contents, configuration) {
	const base = path.resolve(process.cwd(), configuration.directory);

	return Promise.all(contents.map(content => {
		const config = content.config;
		const name = content.name;
		const target = path.resolve(base, `${name}.xml`);
		console.log(`${wait}    Writing ${chalk.bold(name)} config to ${chalk.grey(target)}`);
		return writeFile(target, config)
			.then(() => {
				console.log(`${ok}    Wrote ${chalk.bold(name)} config`);
			});
	}));
}

function connect(host, username, password, promisify) {
	return jenkins({
		baseUrl: host,
		headers: {
			Authorization: `Basic ${new Buffer([username, password].join(':')).toString('base64')}`
		},
		promisify: Boolean(promisify)
	});
}

function fetchProject(api, project) {
	console.log(`${wait}    Fetching ${chalk.bold(project)} config`);
	return api.job.config(project)
		.then(config => {
			console.log(`${ok}    Fetched ${chalk.bold(project)} config`);
			return {name: project, config};
		});
}

function fetchProjects(projects, configuration) {
	const api = connect(configuration.host, configuration.username, configuration.password, true);
	return Promise
		.all(projects.map(project => fetchProject(api, project)))
		.catch(err => {
			err.message = [`${fail}    Error while fetching projects`, err.message];
			return err;
		});
}

function readProjects(projects, configuration) {
	const base = path.resolve(process.cwd(), configuration.directory);

	return Promise.all(projects.map(project => {
		const sourcePath = path.resolve(base, `${project}.xml`);
		console.log(`${wait}    Reading ${chalk.bold(project)} config from ${chalk.grey(sourcePath)}`);
		return readFile(sourcePath)
			.then(config => {
				console.log(`${ok}    Read ${chalk.bold(project)} config`);
				return {name: project, config};
			});
	}));
}

function pushProject(api, name, config) {
	console.log(`${wait}    Pushing ${chalk.bold(name)} config`);
	return new Promise((resolve, reject) => {
		api.job.config(name, config, (err, result) => {
			if (err) {
				return reject(err);
			}
			resolve(result);
		});
	});
}

function pushProjects(contents, configuration) {
	const api = connect(configuration.host, configuration.username, configuration.password, false);
	return Promise
		.all(contents.map(content => pushProject(api, content.name, content.config)))
		.catch(err => {
			err.message = [`${fail}    Error while fetching projects`, err.message].join('\n');
			return err;
		});
}

function getProjectName(projects, configuration) {
	const projectName = configuration._[1] || configuration.default;
	if (projects.indexOf(projectName) === -1) {
		const error = new Error();
		error.message = `${fail}    Project "${chalk.bold(projectName)}" is not available. Available projects: ${projects.join(', ')} ${chalk.gray('[project]')}`;
		throw error;
	}
	return projectName;
}

function buildProject(projectName, configuration) {
	console.log(`${wait}    Triggering build on project ${chalk.bold(projectName)}`);
	const api = connect(configuration.host, configuration.username, configuration.password, true);
	return api.job.build(projectName)
		.then(id => {
			console.log(`${ok}    Triggered build on project ${chalk.bold(projectName)} ${chalk.grey(id)}`);
			return id;
		});
}

function getProjectStatus(projectName, runningProject, configuration) {
	const api = connect(configuration.host, configuration.username, configuration.password, true);

	return api.job.get(projectName)
		.then(data => {
			const lastCompletedId = (data.lastCompletedBuild || {}).number;
			const lastSuccessfullId = (data.lastSuccessfulBuild || {}).number;
			const lastId = (data.lastBuild || {}).number;
			const lastFailedId = (data.lastFailedBuild || {}).number;
			const lastCanceled = (data.lastUnsuccessfulBuild || {}).number;

			const buildStatus = data.lastCompletedBuild === null ? 'unknown' : // eslint-disable-line no-nested-ternary
				lastSuccessfullId === lastCompletedId ? 'passing' : // eslint-disable-line no-nested-ternary
				lastFailedId === lastCompletedId ? 'failing' : // eslint-disable-line no-nested-ternary
				lastCanceled === lastCompletedId ? 'canceled' : 'unknown'; // eslint-disable-line no-nested-ternary

			const currentStatus = data.lastCompletedBuild === null ? 'unknown' : // eslint-disable-line no-nested-ternary
				lastSuccessfullId === lastId ? 'passing' : // eslint-disable-line no-nested-ternary
				lastFailedId === lastId ? 'failing' : // eslint-disable-line no-nested-ternary
				lastCanceled === lastId ? 'canceled' : 'running'; // eslint-disable-line no-nested-ternary

			const buildId = data.inQueue ? runningProject ? lastId : lastId + 1 : // eslint-disable-line no-nested-ternary
				lastCompletedId < lastId ? lastCompletedId + 1 : null; // eslint-disable-line no-nested-ternary

			const etaTime = data.inQueue ?
				(data.queueItem || {}).buildableStartMilliseconds || Infinity :
				0;

			return {
				running: data.inQueue || lastCompletedId < lastId,
				queued: data.inQueue,
				current: currentStatus,
				status: buildStatus,
				last: lastId,
				build: buildId,
				eta: etaTime
			};
		});
}

function getBuildLog(projectName, id, configuration) {
	const api = connect(configuration.host, configuration.username, configuration.password, false);
	return new Promise((resolve, reject) => {
		api.build.log(projectName, id, (err, log) => {
			if (err) {
				return reject(err);
			}
			resolve(log.split('\n'));
		});
	});
}

function watchProject(projectName, runningProject, configuration) {
	console.log(`${wait}    Watching current build on project ${chalk.bold(projectName)}`);
	var line = 0; // eslint-disable-line no-var
	var count = 0; // eslint-disable-line no-var
	var lastChange = new Date(); // eslint-disable-line no-var
	var builds = []; // eslint-disable-line no-var
	const dots = ['.', '..', '...'];

	return new Promise(resolve => {
		const loop = running => {
			if (!running) {
				return getProjectStatus(projectName, runningProject, configuration)
					.then(data => {
						data.build = data.build || builds[builds.length];
						resolve(data);
					});
			}

			return new Promise((resolve, reject) => {
				getProjectStatus(projectName, runningProject, configuration)
					.then(data => {
						count += 1;
						if (data.build && builds.indexOf(data.build) > -1) {
							builds.push(data.build);
						}

						if (builds.length > 1) {
							return data;
						}

						if (data.running && (runningProject || !data.queued)) {
							return getBuildLog(projectName, data.build, configuration)
								.then(log => {
									const output = log.slice(line).map(line => chalk.white(`    ${speech}    ${line}`));
									if (output.length) {
										console.log(output.join('\n'));
										lastChange = new Date();
										line += output.length;
									}
									if (log.length === 10000) {
										singlelog.stdout(`${warn}    Log truncated at ${log.length} lines due to jenkins limits. ${chalk.grey(dots[count % dots.length])}`);
									} else if (new Date() - lastChange > 3000) {
										singlelog.stdout(`${wait}    Waiting for output from jenkins ${chalk.grey(dots[count % dots.length])}`);
									}
									return data;
								})
								.catch(reject);
						} else if (data.queued) {
							const time = data.eta === Infinity || data.eta < new Date() ? '∞' : moment(data.eta).fromNow();
							singlelog.stdout(`${wait}    Waiting for build ${chalk.bold(data.build)} on ${chalk.bold(projectName)} to start: ${chalk.grey(time)} ${chalk.grey(dots[count % dots.length])}\n`);
						} else if (runningProject && !data.running) {
							console.log(`${warn}    No currently active build for ${chalk.bold(projectName)}`);
						}
						return data;
					})
					.then(data => setTimeout(() => loop(data.running && builds.length < 2), 1000))
					.catch(reject);
			});
		};

		loop(true);
	});
}

const tasks = {
	pull(projects, configuration) {
		return fetchProjects(projects, configuration)
			.then(content => writeProjects(content, configuration));
	},
	push(projects, configuration) {
		return readProjects(projects, configuration)
			.then(content => pushProjects(content, configuration));
	},
	status(projects, configuration) {
		const projectName = getProjectName(projects, configuration);
		return getProjectStatus(projectName, false, configuration)
			.then(data => {
				console.log(data.current);
			});
	},
	build(projects, configuration) {
		const projectName = getProjectName(projects, configuration);
		return buildProject(projectName, configuration)
			.then(() => {
				if (configuration.watch !== false) {
					return watchProject(projectName, false, configuration)
						.then(data => {
							if (data.status === 'passing') {
								console.log(`${success}     Build for ${chalk.bold(projectName)} passed`);
							} else if (data.status === 'canceled') {
								console.warn(`${warn}    Build for ${chalk.bold(projectName)} was canceled`);
							} else {
								throw new Error(`${fail}    Build for ${chalk.bold(projectName)} failed with status ${chalk.red(data.status)}`);
							}
						});
				}
			});
	},
	watch(projects, configuration) {
		const projectName = getProjectName(projects, configuration);
		return watchProject(projectName, true, configuration)
			.then(data => {
				return {
					severity: data.passing ? 'info' : 'warn',
					message: data.passing ? `${ok} Build ${data.build} passed` : `${warn} Build ${data.build} failed`
				};
			});
	},
	log(projects, configuration) {
		const projectName = getProjectName(projects, configuration);
		return getProjectStatus(projectName, false, configuration)
			.then(data => {
				console.log(`${wait}    Fetching log for build ${data.last || data.build} of ${projectName}`);
				return getBuildLog(projectName, data.last || data.build, configuration);
			})
			.then(data => console.log(data.join('\n')));
	},
	list(projects) {
		return Promise.resolve(console.info(projects.map(item => `${bullet}    ${item}\n`).join('')));
	},
	version() {
		return Promise.resolve({
			severity: 'info',
			message: pkg.version
		});
	},
	help(project, configuration) {
		console.info('jenkins usage:\n');
		Object.keys(tasks).map(taskName => {
			const description = tasks[taskName].description;
			if (description) {
				console.log(` -    ${chalk.bold(taskName)} - ${tasks[taskName].description}`);
			}
		});
		if (configuration._[0] === 'help') {
			return Promise.resolve();
		}
		throw new Error();
	}
};

// Decorators would be nice
tasks.pull.description = `pull jenkins configuration for [project]`;
tasks.push.description = `push jenkins configuration for [project]`;
tasks.build.description = `trigger build for [project]`;
tasks.watch.description = `watch current build for [project]`;
tasks.list.description = `list available projects`;
tasks.help.description = `print this help`;
tasks.version.description = `outputs the current version`;

function getProjectPackage() {
	try {
		return require(path.resolve(process.cwd(), 'package.json'));
	} catch (err) {
		return {};
	}
}

function main(options) {
	// get all process.env.JENKINS_* variables
	const environment = getEnvironment('JENKINS');
	const projectPackage = getProjectPackage();

	// Merge cli flags and package.json config
	// - read from pkg.config.jenkins
	// - use process.env.JENKINS_* provided by .env
	// - omit user and password, they should not be placed there
	const settings = _.merge(
		{},
		_.omit(((projectPackage.config || {}).jenkins || {}), ['user', 'password']),
		environment,
		options
	);

	// read the command supplied
	const command = settings._[0];
	const task = tasks[command];

	if (['help', 'version', 'h', 'v'].indexOf(command) > -1) {
		return task(null, settings);
	}

	return new Promise((resolve, reject) => {
		const error = new Error();
		error.message = '';

		// Check if task is available
		if (!(command in tasks)) {
			error.message += `${fail}    Command "${chalk.bold(command)}" is not available. Available tasks: ${Object.keys(tasks).join(', ')}. ${chalk.gray('[command]')}\n`;
		}

		// Check if user and password are provided
		if (!settings.username || !settings.password) {
			error.message += `${fail}    Missing credentials. Provide it as cli flags or place a .env file in ${process.cwd()} ${chalk.gray('[--username, --password]')}\n`;
		}

		// Check if all needed information is present
		if (!settings.host) {
			error.message += `${fail}    Missing host. Provide it as cli flag or place a .env file in ${process.cwd()} ${chalk.gray('[--host]')}\n`;
		}

		// how about a list of projects to sync
		if (!settings.projects || (settings.projects && settings.projects.length === 0)) {
			error.message += `${fail}    Missing projects. Provide them as cli flag or place a .env file in ${process.cwd()} ${chalk.gray('[--group]')}\n`;
		}

		if (error.message) {
			error.type = 'jenkins';
			return reject(error);
		}

		task(settings.projects, settings)
			.catch(reject);
	});
}

// parse cli flags
const args = minimist(process.argv.slice(2));

// read .env file
dotenv.config();

// start the main function
main(args)
	.then(payload => {
		if (payload) {
			console[payload.severity](payload.message);
		}
	})
	.catch(error => {
		if (error.type === 'jenkins') {
			console.error(error.message);
			process.exit(1);
		}
		setTimeout(() => {
			throw error;
		}, 0);
	});
