# Build context: the repo root (deploy/compose.yml sets it), so the kit and ui are installed by file path.
FROM node:22.23-slim AS build
WORKDIR /repo
COPY packages/kit-ts/package.json packages/kit-ts/package-lock.json packages/kit-ts/
RUN cd packages/kit-ts && npm ci --ignore-scripts
COPY packages/kit-ts/ packages/kit-ts/
RUN cd packages/kit-ts && npm run build
# ui: esbuild bundles its embed widget into the player, and the Studio pages draw the organiser
# shell with it at run time (src/studio/).
COPY packages/ui/package.json packages/ui/package-lock.json packages/ui/
RUN cd packages/ui && npm ci --ignore-scripts
COPY packages/ui/ packages/ui/
RUN cd packages/ui && npm run build
# npm ci in screen runs the linked packages' `prepare` (a build), so they keep their dev
# dependencies until screen is built; the kit is pruned afterwards.
COPY modules/screen/package.json modules/screen/package-lock.json modules/screen/
RUN cd modules/screen && npm ci
COPY modules/screen/ modules/screen/
RUN cd modules/screen && npm run build && npm prune --omit=dev \
 && cd ../../packages/kit-ts && npm prune --omit=dev \
 && cd ../ui && npm prune --omit=dev

FROM node:22.23-slim
ENV NODE_ENV=production
# ffprobe reads an uploaded video's or sound's container, codecs and length (docs/plans/issue-108.md, D8).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo/packages/kit-ts/package.json packages/kit-ts/
COPY --from=build /repo/packages/kit-ts/dist packages/kit-ts/dist
COPY --from=build /repo/packages/kit-ts/node_modules packages/kit-ts/node_modules
COPY --from=build /repo/packages/ui/package.json packages/ui/
COPY --from=build /repo/packages/ui/dist packages/ui/dist
# The Studio pages serve packages/ui's own stylesheet (src/studio/routes.ts).
COPY --from=build /repo/packages/ui/ui.css packages/ui/ui.css
COPY --from=build /repo/modules/screen/package.json modules/screen/
COPY --from=build /repo/modules/screen/dist modules/screen/dist
COPY --from=build /repo/modules/screen/migrations modules/screen/migrations
COPY --from=build /repo/modules/screen/static modules/screen/static
COPY --from=build /repo/modules/screen/node_modules modules/screen/node_modules
WORKDIR /repo/modules/screen
# nobody (65534), as every module that mounts the files volume: files-init gives it to that user.
USER nobody
EXPOSE 8080
CMD ["node", "dist/main.js"]
