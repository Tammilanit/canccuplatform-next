# Build context: the repo root (deploy/compose.yml sets it), so the kit and ui are installed by file path.
FROM node:22.23-slim AS build
WORKDIR /repo
COPY packages/kit-ts/package.json packages/kit-ts/package-lock.json packages/kit-ts/
RUN cd packages/kit-ts && npm ci --ignore-scripts
COPY packages/kit-ts/ packages/kit-ts/
RUN cd packages/kit-ts && npm run build
COPY packages/ui/package.json packages/ui/package-lock.json packages/ui/
RUN cd packages/ui && npm ci --ignore-scripts
COPY packages/ui/ packages/ui/
RUN cd packages/ui && npm run build
# npm ci in theming runs the linked packages' `prepare` (a build), so they keep their dev
# dependencies until theming is built; all are pruned afterwards.
COPY modules/theming/package.json modules/theming/package-lock.json modules/theming/
RUN cd modules/theming && npm ci
COPY modules/theming/ modules/theming/
RUN cd modules/theming && npm run build && npm prune --omit=dev \
 && cd ../../packages/kit-ts && npm prune --omit=dev \
 && cd ../ui && npm prune --omit=dev

FROM node:22.23-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/packages/kit-ts/package.json packages/kit-ts/
COPY --from=build /repo/packages/kit-ts/dist packages/kit-ts/dist
COPY --from=build /repo/packages/kit-ts/node_modules packages/kit-ts/node_modules
COPY --from=build /repo/packages/ui/package.json packages/ui/
COPY --from=build /repo/packages/ui/dist packages/ui/dist
COPY --from=build /repo/modules/theming/package.json modules/theming/
COPY --from=build /repo/modules/theming/dist modules/theming/dist
COPY --from=build /repo/modules/theming/migrations modules/theming/migrations
COPY --from=build /repo/modules/theming/node_modules modules/theming/node_modules
# The manifest schema, read from the contract itself (src/schema.ts) at the same relative place.
COPY contracts/theme.schema.json contracts/theme.schema.json
WORKDIR /repo/modules/theming
# nobody (65534), as every module that mounts the files volume: files-init gives it to that user.
USER nobody
EXPOSE 8080
CMD ["node", "dist/main.js"]
