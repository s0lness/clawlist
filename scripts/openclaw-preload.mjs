import os from "node:os";

const original = os.networkInterfaces;
os.networkInterfaces = () => {
  try {
    return original();
  } catch {
    return {};
  }
};
