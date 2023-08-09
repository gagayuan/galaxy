/*
    galaxy upload utilities - requires FormData and XMLHttpRequest
*/

import axios from "axios";
import { getAppRoot } from "onload/loadConfig";

import { uploadPayload } from "@/utils/upload-payload.js";
import { uploadSubmit } from "@/utils/upload-submit.js";

export class UploadQueue {
    constructor(options) {
        this.opts = {
            announce: (d) => {},
            get: (d) => {},
            progress: (d, m) => {},
            success: (d, m) => {},
            warning: (d, m) => {},
            error: (d, m) => {
                alert(m);
            },
            complete: () => {},
            multiple: true,
            ...options,
        };
        this.queue = new Map(); // items stored by key (referred to as index)
        this.nextIndex = 0;
        this.fileSet = new Set(); // Used for fast duplicate checking
        this.isRunning = false;
        this.isPaused = false;
    }

    // Add new files to upload queue
    add(files) {
        if (files && files.length && !this.isRunning) {
            files.forEach((file) => {
                const fileSetKey = file.name + file.size; // Concat name and size to create a "file signature".
                if (file.mode === "new" || !this.fileSet.has(fileSetKey)) {
                    this.fileSet.add(fileSetKey);
                    const index = String(this.nextIndex++);
                    this.queue.set(index, file);
                    this.opts.announce(index, file);
                }
            });
        }
    }

    // Set options
    configure(options) {
        this.opts = Object.assign(this.opts, options);
        return this.opts;
    }

    // Remove file from queue and file set by index
    remove(index) {
        const file = this.queue.get(index);
        const fileSetKey = file.name + file.size;
        this.queue.delete(index) && this.fileSet.delete(fileSetKey);
    }

    // Remove all entries from queue
    reset() {
        this.queue.clear();
        this.fileSet.clear();
    }

    // Returns queue size
    get size() {
        return this.queue.size;
    }

    // Initiate upload process
    start(ftpBatch = false) {
        if (ftpBatch) {
            // package ftp files separately, and remove them from queue
            const list = [];
            Object.entries(this.queue).forEach(([key, model]) => {
                if (model.status === "queued" && model.fileMode === "ftp") {
                    this.queue.remove(model.id);
                    list.push(this.opts.get(key));
                }
            });
            if (list.length > 0) {
                const data = uploadPayload(list, this.opts.historyId);
                axios
                    .post(`${getAppRoot()}api/tools/fetch`, data)
                    .then((message) => {
                        list.forEach((model) => {
                            this.opts.success(model.id, message);
                        });
                    })
                    .catch((message) => {
                        list.forEach((model) => {
                            this.opts.error(model.id, message);
                        });
                    });
            }
        }
        if (!this.isRunning) {
            this.isRunning = true;
            this._process();
        }
    }

    // Pause upload process
    stop() {
        this.isPaused = true;
    }

    // Process an upload, recursive
    _process() {
        if (this.size === 0 || this.isPaused) {
            this.isRunning = false;
            this.isPaused = false;
            this.opts.complete();
            return;
        } else {
            this.isRunning = true;
        }
        // Return index to first item in queue (in FIFO order).
        const index = this._processIndex();
        // Collect upload request data
        const data = uploadPayload([this.opts.get(index)], this.opts.historyId);
        // Remove item from queue
        this.remove(index);
        // Initiate upload request
        this._processSubmit(index, data);
    }

    // Get next item to be processed
    _processIndex() {
        return this.queue.keys().next().value;
    }

    // Submit request data
    _processSubmit(index, data) {
        uploadSubmit({
            data: data,
            success: (message) => {
                this.opts.success(index, message);
                this._process();
            },
            warning: (message) => {
                this.opts.warning(index, message);
            },
            error: (message) => {
                this.opts.error(index, message);
                this._process();
            },
            progress: (percentage) => {
                this.opts.progress(index, percentage);
            },
        });
    }
}
