const fs = require('fs-extra');
const util = require('util');
const path = require('path');
const glob = util.promisify(require('glob'));
const {exec} = require("child_process");
const fetch = require('node-fetch');
const { fork } = require('child_process');

/**
 * Loads handlers for the device-manager.
 * Any directory under device-manager/handlers/ is considered to a handler.
 * The configuration file for handlers is device-manager/handlers/handlers.json.
 * This function ensures that handlers follow all guidelines.
 * @return {Promise<{}|null>} If all guidelines are met returns a map of handlers and handler objects, otherwise null.
 */
module.exports.loadHandlers = async function() {
    // ensure that handlers directory exists and it contains a handlers.json config file
    const handlersDirectoryPath = path.join(__dirname, "handlers");
    const handlersJsonPath = path.join(handlersDirectoryPath, "handlers.json");
    let handlersJson = {};

    const exists = await fs.pathExists(handlersJsonPath);
    if(!exists) {
        console.error(`Please ensure that a handlers directory exists and contains a valid handlers.json config file.`);
        return null;
    }

    // ensure that the config file is well-formed
    try {
        handlersJson = await fs.readJson(handlersJsonPath);
    } catch (e) {
        // if there's a JSON parse error, throw an error message
        if(e instanceof SyntaxError) {
            console.error("Handlers.json is not well-formed.");
            return null;
        }
    }

    // ensure that the handlers listed in handlers.json are all in place
    // also ensure that there are no handlers that exist without an entry in handlers.json
    const handlerNames = Object.keys(handlersJson);
    // get all first level directory names (ignore any files)
    const handlersOnDisk = await glob('*', {ignore: '*.*', cwd: handlersDirectoryPath});

    const onDiskNotInConfig = handlersOnDisk.filter(handler => !handlerNames.includes(handler));
    const inConfigNotOnDisk = handlerNames.filter(handler => !handlersOnDisk.includes(handler));

    const handlersWithoutConfigFound = onDiskNotInConfig.length !== 0;
    const handlersNotFoundOnDisk = inConfigNotOnDisk.length !== 0;
    if(handlersWithoutConfigFound) {
        console.error(`Handlers detected without entries in config file: ${onDiskNotInConfig}`);
    }
    if(handlersNotFoundOnDisk) {
        console.error(`Handlers not found on disk: ${inConfigNotOnDisk}`);
    }
    if(handlersWithoutConfigFound || handlersNotFoundOnDisk) {
        return null;
    }

    // ensure that the 'main' script listed for each handler exists
    const mainScriptPaths =
        Object.entries(handlersJson).map(entry => path.join(handlersDirectoryPath, entry[0], entry[1]['main']));

    const mainScriptsStatus = await checkPathsExist(mainScriptPaths,
        handlerNames,
        "",
        "${name}'s main script does not exist.");
    if(!mainScriptsStatus) {
        return null;
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
        return null;
    }

    /*
    We have a requirement that controller npm packages should not be installed on a per handler basis, i.e. should not
    exist in multiple node_modules/ directories. This is because controllers are singletons which access some underlying
    hardware. Each hardware must have a single controller which arbitrates handler access to that hardware.
    Enforcing single installation of controller packages became easier due to npm's design. By design, 'npm install'
    looks for a node_modules/ directory anywhere in the working directory all the way upto the root directory. Since we
    have npm packages installed in the platform/ directory, we can just do 'npm install' at each handler directory and
    the packages get installed in platform/node_modules. (controllers are part of the package dependencies of handlers)
     */

    // ensure that each handler directory has a package.json file
    const packageJsonStatus =
        await checkPathsExist(handlerNames.map(handler => path.join(handlersDirectoryPath, handler, 'package.json')),
            handlerNames,
            'Some of the handlers have missing package.json files. Please ensure that each handler uses one.',
            '${name} has a missing package.json');
    if(!packageJsonStatus) {
        return null;
    }

    // TODO npm install controller packages separately. Install other dependencies for each handler in the local dir.
    // do npm install in each handler directory
    // try {
    //     const execResults = await Promise.all(handlerNames.map(handler =>
    //         executeCommand('npm install', path.join(handlersDirectoryPath, handler))));
    //
    //     execResults.forEach((result, index) => {
    //         console.log(`${handlerNames[index]}:`);
    //         console.log(result['stdout']);
    //     });
    // } catch (err) {
    //     console.error('Failed to perform npm install in one of the handlers. Please check error:');
    //     console.error(err);
    //     return null;
    // }

    // create a map of handlerName -> handlerObj
    // we send a map to aid in looking up the handlerObj from a handlerName.
    // eg: send(deviceId) -> handlerObj.dispatch(deviceId) would require deviceId -> handler -> handlerObj
    const handlerObjMap = {};
    handlerNames.forEach((handlerName, index) => {
        // create objects for each handler
        const HandlerClass = require(mainScriptPaths[index]);
        // Pass the handler's name as its id. Will be used by it to identify itself when communicating with the platform.
        handlerObjMap[handlerName] = new HandlerClass(handlerName);
    });
    return handlerObjMap;
};

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
