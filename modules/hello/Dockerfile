# Build context: the repo root (deploy/compose.yml sets it), so the kit is installed by file path.
FROM node:22.23-slim AS build
WORKDIR /repo
COPY packages/kit-ts/package.json packages/kit-ts/package-lock.json packages/kit-ts/
RUN cd packages/kit-ts && npm ci --ignore-scripts
COPY packages/kit-ts/ packages/kit-ts/
RUN cd packages/kit-ts && npm run build
# npm ci in hello runs the linked kit's `prepare` (a build), so the kit keeps its dev
# dependencies until hello is built; both are pruned afterwards.
COPY modules/hello/package.json modules/hello/package-lock.json modules/hello/
RUN cd modules/hello && npm ci
COPY modules/hello/ modules/hello/
RUN cd modules/hello && npm run build && npm prune --omit=dev \
 && cd ../../packages/kit-ts && npm prune --omit=dev

FROM node:22.23-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/packages/kit-ts/package.json packages/kit-ts/
COPY --from=build /repo/packages/kit-ts/dist packages/kit-ts/dist
COPY --from=build /repo/packages/kit-ts/node_modules packages/kit-ts/node_modules
COPY --from=build /repo/modules/hello/package.json modules/hello/
COPY --from=build /repo/modules/hello/dist modules/hello/dist
COPY --from=build /repo/modules/hello/node_modules modules/hello/node_modules
WORKDIR /repo/modules/hello
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
