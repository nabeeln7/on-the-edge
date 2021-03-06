const fs = require('fs-extra');
const util = require('util');
const path = require('path');
const glob = util.promisify(require('glob'));
const {exec} = require("child_process");
const fetch = require('node-fetch');

let handlersJson = {};

/**
 * Loads handlers for the device-manager.
 * Any directory under device-manager/handlers/ is considered to be a handler.
 * The configuration file for handlers is device-manager/handlers/handlers.json.
 * @return {Promise<{}|null>} returns a map of handler->handlerObj if loading was successful, otherwise returns null.
 */
async function loadHandlers() {
    // store the handlersJson file for later use in getControllerId()
    handlersJson = await getHandlers();
    if(handlersJson == null) {
        return null;
    }

    // ensure that the handlers listed in handlers.json are all in place
    // also ensure that there are no handlers that exist without an entry in handlers.json
    const handlerNames = Object.keys(handlersJson);

    // ensure that the 'main' script listed for each handler exists
    const mainScriptPaths =
        Object.entries(handlersJson).map(entry => path.join(__dirname, entry[0], entry[1]['main']));

    // create a map of handlerName -> handlerObj
    // we send a map to aid in looking up the handlerObj from a handlerName.
    // eg: send(deviceId) -> handlerObj.dispatch(deviceId) would require deviceId -> handler -> handlerObj
    try {
        // for each handler name, load its node.js module
        const handlerModules = await Promise.all(handlerNames.map((handlerName, index) =>
            getHandlerModule(handlerName, mainScriptPaths[index])));

        const handlerObjMap = {};
        // iterate over handlerNames and handlerModules to populate handlerObjMap
        handlerNames.forEach((handlerName, index) => handlerObjMap[handlerName] = handlerModules[index]);
        return handlerObjMap;
    } catch(err) {
        return null;
    }
}

/**
 * Load the nodejs module for a given handler
 * @param handlerName The name of the handler
 * @param handlerScriptPath The handler's main script path
 * @return {Promise<module>}
 */
async function getHandlerModule(handlerName, handlerScriptPath) {
    return new Promise((resolve, reject) => {
        try {
            const HandlerClass = require(handlerScriptPath);
            // Pass the handler's name as its id. Will be used by it to identify itself when communicating with the platform.
            const handlerModule = new HandlerClass(handlerName);
            resolve(handlerModule);
        } catch (err) {
            if(err.code === 'MODULE_NOT_FOUND') {
                console.error('Dependencies for some of the handlers not installed. ' +
                    'Please run device-manager/handlers/install-handlers.js before starting the platform. ');
                console.error(err.message);
                reject(err);
            }
        }
    });
}

/**
 * Installs the dependencies for all of the handlers.
 * Packages for controllers are installed once into the platform-manager/node_modules/ directory to ensure singleton
 * operation.
 * @return {Promise<boolean>} status of the installation
 */
async function installHandlers() {
    const handlersJson = await getHandlers();
    if(handlersJson == null) {
        return false;
    }

    // ensure that the handlers listed in handlers.json are all in place
    // also ensure that there are no handlers that exist without an entry in handlers.json
    const handlerNames = Object.keys(handlersJson);
    // get all first level directory names (ignore any files)
    const handlersOnDisk = await glob('*', {ignore: '*.*', cwd: __dirname});

    const inConfigNotOnDisk = handlerNames.filter(handler => !handlersOnDisk.includes(handler));
    if(inConfigNotOnDisk.length !== 0) {
        console.error(`Handlers not found on disk: ${inConfigNotOnDisk}`);
        return false;
    }

    // ensure that the 'main' script listed for each handler exists
    const mainScriptPaths =
        Object.entries(handlersJson).map(entry => path.join(__dirname, entry[0], entry[1]['main']));

    const mainScriptsStatus = await checkPathsExist(mainScriptPaths,
        handlerNames,
        "",
        "${name}'s main script does not exist.");
    if(!mainScriptsStatus) {
        return false;
    }

    // ensure that the specified controllers are listed on the npm repo
    // set-ify to remove duplicates
    const controllersSet = new Set(Object.values(handlersJson).map(handlerInfo => handlerInfo["controller"]));
    const controllers = [...controllersSet];

    // asynchronously check if each controller exist on the npm repo
    const npmPackageStatus = await checkNpmPackagesValid(controllers,
        '',
        '${name} does not exist in the npm registry.');
    if(!npmPackageStatus) {
        return false;
    }

    /*
    We have a requirement that controller npm packages should not be installed on a per handler basis, i.e. should not
    exist in multiple node_modules/ directories. This is because controllers are singletons which access some underlying
    hardware. Each hardware must have a single controller which arbitrates handler access to that hardware.
    So we install controllers in the platform-manager/ path. Then for each handler, we install their dependencies excluding
    the controller packages. (controllers are part of the package dependencies of handlers)
     */

    // first, install the controller packages in the platform-manager directory
    try {
        await installNpmDependencyList(path.join(__dirname, '..', '..'), controllers);
    } catch (err) {
        console.error(`failed to install the controller packages ${controllers}`);
        console.error(err);
        return false;
    }

    // before installing the dependencies for each handler, ensure that each handler directory has a package.json file
    const handlerPackageJsonPaths = handlerNames.map(handler => path.join(__dirname, handler, 'package.json'));
    const packageJsonStatus =
        await checkPathsExist(handlerPackageJsonPaths,
            handlerNames,
            'Some of the handlers have missing package.json files. Please ensure that each handler uses one.',
            '${name} has a missing package.json');
    if(!packageJsonStatus) {
        return false;
    }

    // for each handler, find their deps except their controller package dependency
    // dependenciesList -> list of each handler's dependencies. [{}, {}, {}, ..]
    const dependenciesList =
        await Promise.all(handlerPackageJsonPaths.map((packageJsonPath, handlerIndex) => {
            return fs.readJson(packageJsonPath).then(packageJson => {
                const dependencies = packageJson["dependencies"];

                // remove the controller dependency from this
                // get the handler name for this index
                const handlerName = handlerNames[handlerIndex];
                // get handler's controller name
                const controller = handlersJson[handlerName]["controller"];
                // remove the controller dependency
                delete dependencies[controller];
                return dependencies;
            });
        }));

    // install the dependencies
    try {
        await Promise.all(dependenciesList.map((dependencies, handlerIndex) => {
            const handlerName = handlerNames[handlerIndex];
            return installNpmDependencies(path.join(__dirname, handlerName), dependencies);
        }));
    } catch (err) {
        console.error(`failed to install npm packages for some of the handlers`);
        console.error(err);
        return false;
    }
    return true;
}

/**
 * Get the handlers in handlers.json
 * @return {Promise<null|{}>}
 */
async function getHandlers() {
    const handlersJsonPath = path.join(__dirname, "handlers.json");

    const exists = await fs.pathExists(handlersJsonPath);
    if(!exists) {
        console.error(`Please ensure that the handlers directory contains a valid handlers.json config file.`);
        return null;
    }

    // ensure that the config file is well-formed
    try {
        handlersJson = await fs.readJson(handlersJsonPath);
        return handlersJson;
    } catch (e) {
        // if there's a JSON parse error, throw an error message
        if(e instanceof SyntaxError) {
            console.error("Handlers.json is not well-formed.");
            return null;
        }
    }
}

/**
 * Installs npm packages in the specified directory
 * @param installPath path to perform the installation
 * @param dependencies dependencies listed in the same style as in package.json
 * @return {Promise<result>}
 */
function installNpmDependencies(installPath, dependencies) {
    // convert dependencies from object style to a list of packages
    const dependencyList = parseNpmDependencies(dependencies);
    if(dependencyList.length !== 0) {
        return installNpmDependencyList(installPath, dependencyList);
    }
}

/**
 * Installs npm packages in a list format to the specified directory
 * @param installPath
 * @param dependencyList list of packages. For instance, ["mqtt@latest", "lodash@^4.17.19"]
 * @return {Promise<result>}
 */
function installNpmDependencyList(installPath, dependencyList) {
    const spaceSepDependencies = dependencyList.reduce((dep1, dep2) => `${dep1} ${dep2}`);
    return executeCommand(`npm install ${spaceSepDependencies}`, installPath);
}

/**
 * Parses the npm dependencies object into a list of dependency strings
 * For ex: "mqtt": "^3.0.0" -> "mqtt@^3.0.0"
 * @param dependencies
 * @return {string[]}
 */
function parseNpmDependencies(dependencies) {
    return Object.keys(dependencies).map(dependency => {
        const dependencyVersion = dependencies[dependency];
        return `${dependency}@${dependencyVersion}`
    });
}

/**
 * Checks if the packages exist on the npm registry.
 * @param packages array of npm packages
 * @param overallErrorMsg print this once if any of the packages are invalid
 * @param individualErrorMsg print for each invalid package. Customize using the '${name}' for the package name.
 * @return {Promise<boolean>} Returns true if all packages are valid, false otherwise.
 */
async function checkNpmPackagesValid(packages, overallErrorMsg, individualErrorMsg) {
    return testBooleanFunctionOnArray(isValidNpmPackage,
        packages,
        packages,
        overallErrorMsg,
        individualErrorMsg);
}

/**
 * Checks if an array of filePaths exist or not.
 * @param filePaths array of path strings
 * @param names names of files. Should be the corresponding index to the filePaths array.
 * @param {string} overallErrorMsg print this once if any of the paths are invalid
 * @param {string} individualErrorMsg print for each invalid path. Customize using the '${name}' for the file name.
 * @return {Promise<boolean>}
 */
async function checkPathsExist(filePaths, names, overallErrorMsg, individualErrorMsg) {
    return testBooleanFunctionOnArray(fs.pathExists,
        filePaths,
        names,
        overallErrorMsg,
        individualErrorMsg);
}

/**
 * This tests a boolean function against each element of a given testArray.
 * It also prints the overallErrorMsg ONCE if any of the elements do not satisfy the boolean function. For any failed
 * elements, the function prints the individualErrorMsg by substituting the name of the element from
 * the supplied "names" array in place of ${name}. If any of the element checks fail, the process returns false, else
 * true.
 * This is a helper function to avoid code duplication.
 * @param boolFunction The boolean function to test against testArray
 * @param testArray Each element of this array is tested for boolFunction
 * @param nameArray Supplies the names of elements in the testArray. Ensure indices correspond to the testArray.
 * @param overallErrorMsg
 * @param individualErrorMsg
 * @return {Promise<boolean>}
 */
// TODO: make nameArray an optional parameter
async function testBooleanFunctionOnArray(boolFunction, testArray, nameArray, overallErrorMsg, individualErrorMsg) {
    const results = await Promise.all(testArray.map(elem => boolFunction(elem)));

    // filter names with a missing filePath by comparing with the results array
    const namesForFailedElements = nameArray.filter((_, index) => !results[index]);

    // if any of the result fails, show an error message and exit
    if(namesForFailedElements.length !== 0) {
        if(overallErrorMsg.length !== 0) {
            console.error(overallErrorMsg);
        }
        namesForFailedElements.forEach(name => {
            console.error(individualErrorMsg.replace('${name}', name));
        });
        return false;
    }
    return true;
}

/**
 * Check if given npm package is valid. Currently uses the npms.io API.
 * @param packageName
 * @return {PromiseLike<boolean> | Promise<boolean>}
 */
function isValidNpmPackage(packageName) {
    const checkNpmPackageUrl = `https://api.npms.io/v2/package/${packageName}`;
    return fetch(checkNpmPackageUrl, {method: 'GET'})
        .then(body => body.json())
        .then(json => {
            return !(json.hasOwnProperty("code") && json['code'] === 'NOT_FOUND');
        });
}

/**
 * Executes the given shell command
 * @param cmd command to be executed
 * @param cwd working directory to execute command
 * @return {Promise<result>} result object with 'stdout' and 'stderr' logs
 */
function executeCommand(cmd, cwd) {
    console.log(`execute ${cmd} in ${cwd}`);
    const execP = util.promisify(exec);
    const options = {
        'cwd': cwd
    };
    return execP(cmd, options);
}

/**
 * Get the controllerId for a given handlerId
 * @param handlerId
 * @return {*}
 */
function getControllerId(handlerId) {
    return handlersJson[handlerId]['controller'];
}

module.exports = {
    loadHandlers: loadHandlers,
    installHandlers: installHandlers,
    getControllerId: getControllerId
};