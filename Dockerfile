# --- Build Stage ---
FROM node:18-alpine AS build

COPY . .

RUN yarn install
RUN yarn run build

FROM node:18-alpine AS run

COPY --from=build /build ./

ENV WEEB_SYNC_SERVER_HTTP_PORT=42380

# Define the command that Docker should run when your image is executed
CMD [ "node", "index.js" ]
