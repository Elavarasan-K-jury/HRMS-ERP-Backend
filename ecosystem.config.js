module.exports = {
    apps: [
        {
            name: "Jury-HRMS||Backend",
            script: "npm",
            args: "run start",
            interpreter: "bash",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "300M",
            env: {
                NODE_ENV: "production"
            }
        }
    ]
};
