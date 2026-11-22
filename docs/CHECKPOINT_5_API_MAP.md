# Checkpoint 5 API map

| Screen | Existing Fastify contract |
| --- | --- |
| Login and account | POST /api/auth/sign-in/email, POST /api/auth/sign-out, GET /api/users/me |
| Dockyards | GET and POST /api/dockyard with notes. Status filters use the returned status values. |
| Dockyard details | GET /api/dockyard/:id. Add the caller's membership role to the existing response for UI permission checks. |
| Members | GET and POST /api/dockyard/:id/members, PATCH and DELETE /api/dockyard/:id/members/:userId. Owner or Super Admin. |
| Files | GET and POST /api/dockyard/:id/files, GET and DELETE /api/dockyard/:id/files/:fileId, GET /download, POST /verify and POST /signed-url on the file resource. |
| API keys | GET and POST /api/dockyard/:id/api-keys, DELETE /api/dockyard/:id/api-keys/:keyId, POST /api/dockyard/:id/api-keys/:keyId/rotate. Owner, Manager or Super Admin. |
| Connect | GET /api/integration/me for external X-API-Key authentication. |

Member creation takes an existing user ID. The API has no Dockyard-scoped email directory, so the UI accepts a user ID. The file API has no thumbnail endpoint. Preview uses authenticated download for supported raster images in AVAILABLE state. The current Dockyard model has notes and no separate display name.
