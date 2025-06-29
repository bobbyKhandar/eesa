import FastGlob from "fast-glob";
const entries = FastGlob.sync(
  `${`C:/Users/bobby/Downloads/Past Question Papers-20250521T094120Z-1-001/Past Question Papers/`}/**/*.pdf`
);
console.log(entries.length);
