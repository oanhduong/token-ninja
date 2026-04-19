const isTTY = process.stderr.isTTY;
const color = (c: string, s: string) => (isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);

let verbose = false;

export const logger = {
  setVerbose(v: boolean) {
    verbose = v;
  },
  debug(msg: string) {
    if (verbose) process.stderr.write(`${color("90", "[ninja debug]")} ${msg}\n`);
  },
  info(msg: string) {
    process.stderr.write(`${color("36", "[ninja]")} ${msg}\n`);
  },
  warn(msg: string) {
    process.stderr.write(`${color("33", "[ninja warn]")} ${msg}\n`);
  },
  error(msg: string) {
    process.stderr.write(`${color("31", "[ninja error]")} ${msg}\n`);
  },
  success(msg: string) {
    if (verbose) process.stderr.write(`${color("32", "[ninja ok]")} ${msg}\n`);
  },
};
