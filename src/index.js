#!/usr/bin/env node

const { spawn } = require("child_process");
const pkg = require("../package.json");

const { version, name: cliName, description } = pkg;
const APP_CENTER_CLI = "/usr/local/bin/appcenter";

/**----------------------------------------------------------
/** Util
/**----------------------------------------------------**/
class DiffPrinter {
    constructor(type = "Installer") {
        this.missing = [];
        this.changed = [];
        this.type = type;
    }

    addChange(pkg, fromVersion, toVersion) {
        const line = `${pkg} changed from ${fromVersion} to ${toVersion}`;
        this.changed.push(line);
    }

    addMissing(pkg) {
        this.missing.push(pkg);
    }

    print() {
        console.log(`\n`);
        if (this.changed.length) {
            console.log(
                `--------- What Was Changed in ${this.type} ---------------------------------------------`
            );
            this.changed.forEach(line => {
                console.log(line);
            });
        }

        if (this.missing.length) {
            console.log(
                `--------- What Was Removed from ${this.type} ---------------------------------------------`
            );
            this.missing.forEach(line => {
                console.log(line);
            });
        }
        console.log(
            "------------------------------------------------------------------------\n"
        );
    }
}

/**----------------------------------------------------------
/** Processors
/**----------------------------------------------------*/
class NpmDiffProcessor {
    constructor({ successfulLines, failedLines }) {
        this.successfulLines = successfulLines;
        this.failedLines = failedLines;
    }

    async process() {
        const successfulVersions = this._filterReduce(this.successfulLines);
        const failedVersions = this._filterReduce(this.failedLines);
        const diffs = this._determineDiffs(successfulVersions, failedVersions);
        return diffs;
    }

    _filterReduce(lines) {
        const delim = "├─";
        return lines
            .filter(l => l.includes(delim))
            .reduce((map, line) => {
                const [, pkgStr] = line.split(delim);
                const index = pkgStr.lastIndexOf("@");
                const pkg = pkgStr.substring(0, index).trim();
                const version = pkgStr.substring(index + 1).trim();

                map[pkg] = version;
                return map;
            }, {});
    }

    _determineDiffs(successfulVersions, failedVersions) {
        const diffs = new DiffPrinter("NPM");

        for (const key in successfulVersions) {
            const version = successfulVersions[key];
            if (!failedVersions[key]) {
                diffs.addMissing(key);
            } else if (failedVersions[key] !== version) {
                diffs.addChange(key, version, failedVersions[key]);
            }
        }
        return diffs;
    }
}

/**----------------------------------------------------------
/** CLI
/**----------------------------------------------------*/
const INCLUDED_PROCESSORS = [NpmDiffProcessor];

const __main__ = async () => {
    const { opts } = parseArgs();

    if (opts.help) {
        return printHelp();
    }

    const { app } = opts;
    const successful = opts["successful-build"];
    const failed = opts["failed-build"];

    if (!successful) {
        printHelp("--successful-build must be set");
    } else if (!failed) {
        printHelp("--failed-build must be set");
    }

    try {
        const successfulLines = await downloadLogs(successful, app);
        const failedLines = await downloadLogs(failed, app);
        for (var i = 0; i < INCLUDED_PROCESSORS.length; i++) {
            const processor = new INCLUDED_PROCESSORS[i]({
                successfulLines,
                failedLines
            });
            const diffs = await processor.process();
            diffs.print();
        }
    } catch (error) {
        processError(error);
    }
};

const downloadLogs = (buildNumber, app) => {
    return new Promise((resolve, reject) => {
        const stdout = [];
        const stderr = [];

        const append = pipe => data => {
            const lines = Buffer.from(data)
                .toString("utf8")
                .split("\n");
            lines.filter(l => l).forEach(l => pipe.push(l));
        };

        function onClose(code) {
            if (code !== 0) {
                return reject(
                    new Error(
                        `Unable to download logs for build ${buildNumber} of ${app}\n${[
                            ...stdout,
                            ...stderr
                        ].join("\n")}`
                    )
                );
            }
            return resolve(stdout);
        }

        const ls = spawn(APP_CENTER_CLI, [
            "build",
            "logs",
            `--id=${buildNumber}`,
            `--app=${app}`
        ]);
        ls.stdout.on("data", append(stdout));
        ls.stderr.on("data", append(stderr));
        ls.on("close", onClose);
    });
};

const processError = error => {
    console.error(`${error.message}\n`);
    process.exit(error.code || -1);
};

const printHelp = error => {
    if (error) {
        console.warn(`[BuildDiffer ERROR] ${error}\n`);
    }

    console.log(`${cliName} v${version}
  Help: ${description}

  Usage:
    ${cliName} --successful-build=100 --failed-build=101

  Opts:
    --successful-build : Number of last successful build (required)
    --failed-build     : Number of failed build (required)

  Args:
    --help
`);
    return process.exit(error ? -1 : 0);
};

const parseArgs = () => {
    const args = [];
    const opts = {};
    const argv = process.argv || [];

    argv.forEach(arg => {
        if (arg.includes("--")) {
            const [key, value] = arg.split("=");
            opts[key.replace("--", "").trim()] =
                value === undefined ? true : value;
        }
    });

    return { args, opts };
};

/**----------------------------------------------------------
/** Main
/**----------------------------------------------------*/
__main__();
