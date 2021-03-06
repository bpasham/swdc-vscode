import {
    getOs,
    getVersion,
    logIt,
    getNowTimes,
    getPluginId,
    setItem
} from "../Util";
import { FileChangeInfo, TimeData } from "./models";
import { EventManager } from "../managers/EventManager";
import { UNTITLED_WORKSPACE, NO_PROJ_NAME } from "../Constants";
import { Project } from "./Project";
import {
    getTodayTimeDataSummary,
    incrementSessionAndFileSeconds
} from "../storage/TimeSummaryData";
import { getMinutesSinceLastPayload } from "../storage/SessionSummaryData";

const eventHandler: EventManager = EventManager.getInstance();

export class KeystrokeStats {
    public source: {};
    public keystrokes: Number;
    public start: Number;
    public local_start: Number;
    public timezone: string;
    public project: Project;
    public pluginId: Number;
    public version: string;
    public os: string;
    public repoContributorCount: Number;
    public repoFileCount: Number;

    constructor(project: Project) {
        this.source = {};
        this.keystrokes = 0;
        this.project = project;
        this.pluginId = getPluginId();
        this.version = getVersion();
        this.os = getOs();
        this.repoContributorCount = 0;
        this.repoFileCount = 0;
        this.keystrokes = 0;
    }

    getCurrentStatsData() {
        return JSON.parse(JSON.stringify(this));
    }

    /**
     * check if the payload should be sent or not
     */
    hasData() {
        const keys = Object.keys(this.source);
        if (!keys || keys.length === 0) {
            return false;
        }

        // delete files that don't have any kpm data
        let foundKpmData = false;
        if (this.keystrokes > 0) {
            foundKpmData = true;
        }

        // Now remove files that don't have any keystrokes that only
        // have an open or close associated with them. If they have
        // open AND close then it's ok, keep it.
        let keystrokesTally = 0;
        keys.forEach(key => {
            const data: FileChangeInfo = this.source[key];

            const hasOpen = data.open > 0;
            const hasClose = data.close > 0;
            // tally the keystrokes for this file
            data.keystrokes =
                data.add +
                data.paste +
                data.delete +
                data.linesAdded +
                data.linesRemoved;
            const hasKeystrokes = data.keystrokes > 0;
            keystrokesTally += data.keystrokes;
            if (
                (hasOpen && !hasClose && !hasKeystrokes) ||
                (hasClose && !hasOpen && !hasKeystrokes)
            ) {
                // delete it, no keystrokes and only an open
                delete this.source[key];
            } else if (!foundKpmData && hasOpen && hasClose) {
                foundKpmData = true;
            }
        });

        if (keystrokesTally > 0 && keystrokesTally !== this.keystrokes) {
            // use the keystrokes tally
            foundKpmData = true;
            this.keystrokes = keystrokesTally;
        }
        return foundKpmData;
    }

    /**
     * send the payload
     */
    async postData(sendNow: boolean = false) {
        // set the end time for the session
        let nowTimes = getNowTimes();

        // get the payload
        const payload = JSON.parse(JSON.stringify(this));

        payload["end"] = nowTimes.now_in_sec;
        payload["local_end"] = nowTimes.local_now_in_sec;
        const keys = Object.keys(payload.source);

        // what is the gap from the previous start
        const incrementMinutes = getMinutesSinceLastPayload();

        // increment the projects session and file seconds
        await incrementSessionAndFileSeconds(payload.project, incrementMinutes);

        // get the time data summary (get the latest editor seconds)
        const td: TimeData = await getTodayTimeDataSummary(payload.project);

        // get the editor seconds
        let editor_seconds = 60;
        if (td) {
            editor_seconds = Math.max(td.editor_seconds, td.session_seconds);
        }

        // go through each file and make sure the end time is set
        // and the cumulative_editor_seconds is set
        if (keys && keys.length > 0) {
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                // ensure there is an end time
                const end = parseInt(payload.source[key]["end"], 10) || 0;
                if (end === 0) {
                    // set the end time for this file event
                    let nowTimes = getNowTimes();
                    payload.source[key]["end"] = nowTimes.now_in_sec;
                    payload.source[key]["local_end"] =
                        nowTimes.local_now_in_sec;
                }

                payload["cumulative_editor_seconds"] = editor_seconds;
            }
        }

        payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!payload.project || !payload.project.directory) {
            payload["project"] = {
                directory: NO_PROJ_NAME,
                name: UNTITLED_WORKSPACE,
                identifier: "",
                resource: {}
            };
        }

        if (sendNow) {
            eventHandler.sendBatchPayload("/data/batch", [payload]);
        } else {
            await eventHandler.storePayload(payload);
            logIt(`storing kpm metrics`);
        }
    }
}
