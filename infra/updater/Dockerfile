# updater — the product-owned upgrade worker. Watches a signal file the backend writes and
# runs `docker compose pull && up -d` for this project. It is the ONLY container with docker
# access; the backend stays docker.sock-free ([[product-owned-upgrade]]).
FROM docker:27-cli

# docker:cli ships the CLI + buildx; add the compose plugin explicitly so `docker compose`
# (the recreate mechanism) is present rather than assumed.
RUN apk add --no-cache docker-cli-compose

COPY infra/updater/updater.sh /usr/local/bin/updater.sh
RUN chmod +x /usr/local/bin/updater.sh

ENTRYPOINT ["/usr/local/bin/updater.sh"]
