module.exports = {
  apps: [
    {
      name: "freedomshare-landing",
      script: "server.js",
      cwd: "/var/www/freedomshare-landing",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 8080
      }
    }
  ]
};
