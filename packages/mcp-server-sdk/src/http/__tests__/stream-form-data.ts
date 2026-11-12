import { EventEmitter } from "node:events";

/**
 * Minimal stand-in for the `form-data` package: getHeaders()/pipe() mark it as
 * stream FormData, and resume() emits the body the fetch client collects.
 */
export function streamFormData() {
  const fd = Object.assign(new EventEmitter(), {
    getHeaders: () => ({ "content-type": "multipart/form-data; boundary=x" }),
    pipe: () => fd,
    resume: () => {
      fd.emit("data", "--x\r\n");
      fd.emit("data", Buffer.from("body\r\n--x--\r\n"));
      fd.emit("end");
    },
  });
  return fd;
}
