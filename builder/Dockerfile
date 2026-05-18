# Sandbox custom-page builder. Polls /internal/builds/claim, runs vite,
# writes dist into shared volume /srv/custom-pages/<page_id>/<build_id>/dist/,
# PATCHes status. No docker.sock; relies on shared named volume.

FROM node:22-alpine

WORKDIR /opt/builder

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY template ./template
COPY runner.mjs ./runner.mjs

RUN mkdir -p /tmp/work /srv/custom-pages

ENV BACKEND_INTERNAL_URL=http://backend:8000
ENV CUSTOM_PAGES_ROOT=/srv/custom-pages

CMD ["node", "/opt/builder/runner.mjs"]
