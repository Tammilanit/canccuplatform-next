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
# npm ci in pizza runs the linked packages' `prepare` (a build), so they keep their dev
# dependencies until pizza is built; all are pruned afterwards.
COPY modules/pizza/package.json modules/pizza/package-lock.json modules/pizza/
RUN cd modules/pizza && npm ci
COPY modules/pizza/ modules/pizza/
RUN cd modules/pizza && npm run build && npm prune --omit=dev \
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
# The pages serve packages/ui's own stylesheet (src/pages/kit.ts).
COPY --from=build /repo/packages/ui/ui.css packages/ui/ui.css
COPY --from=build /repo/modules/pizza/package.json modules/pizza/
COPY --from=build /repo/modules/pizza/dist modules/pizza/dist
COPY --from=build /repo/modules/pizza/migrations modules/pizza/migrations
COPY --from=build /repo/modules/pizza/static modules/pizza/static
COPY --from=build /repo/modules/pizza/node_modules modules/pizza/node_modules
WORKDIR /repo/modules/pizza
USER nobody
EXPOSE 8080
CMD ["node", "dist/main.js"]
