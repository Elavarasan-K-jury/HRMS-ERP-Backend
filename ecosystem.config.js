// ecosystem.config.js
module.exports = {
    apps: [
        {
            name: "my-app",
            script: "npm",
            args: "run start",
            cwd: __dirname,              // runs from project root
            instances: 1,                // set to "max" for cluster mode
            exec_mode: "fork",           // or "cluster"
            autorestart: true,
            watch: false,                // set true only if you want auto-reload on file changes
            max_memory_restart: "512M",
            env: {
                NODE_ENV: "production",
                PORT: "3000",
            },
        },
    ],
};
