export const dockerTarget = process.env.VAULTFS_DOCKER_E2E === "1";
export const apiBase = dockerTarget ? "http://127.0.0.1:4415/api" : "http://127.0.0.1:4315/api";
export const webBase = dockerTarget ? "http://127.0.0.1:4416" : "http://127.0.0.1:4316";
