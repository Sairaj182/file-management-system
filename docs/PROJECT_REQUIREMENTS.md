
# VaultFS — File Management System (FMS)

A secure, modular, warehouse-based file management platform designed to provide centralized file storage and controlled file access to multiple applications through APIs.

---

## 1. Project Overview

VaultFS (File Management System) is a self-hosted file management platform that provides centralized storage, organization, access control, and retrieval of files.

The system follows the concept of cloud object storage, where files are grouped into logical storage units called **Warehouses**. A warehouse behaves similarly to an S3 bucket: it provides an isolated logical boundary for organizing files and controlling access.

**Domain terminology:** Dockyard is VaultFS's product term for a Warehouse. They are the same logical storage concept. The existing Prisma `Dockyards` model and its relationships are the compatibility baseline; do not create a parallel Warehouse table/model or remove/rename existing rows as part of Phase 0. Future schema evolution must be additive or use a reviewed data-preserving migration.

Instead of requiring every application to implement its own file upload, download, authentication, and storage logic, VaultFS provides these capabilities through a common service and API layer.

The project focuses on:

- Centralized file management.
- Warehouse-based storage organization.
- Role-Based Access Control (RBAC).
- API-based file uploads.
- Secure file downloads through signed URLs.
- File metadata management and verification.
- Session-based and API-key authentication.
- Administrative management of users, warehouses, and files.

### Project Vision

To develop a reusable file-management service that can be integrated with multiple independent applications without requiring each application to manage its own file storage infrastructure.

---

## 2. Project Objectives

1. Develop a centralized file management system that supports multiple applications.
2. Organize files into logical warehouses with controlled access.
3. Implement secure authentication and authorization mechanisms.
4. Provide APIs for uploading, downloading, and deleting files.
5. Support API-key authentication for programmatic integrations.
6. Generate temporary signed URLs for controlled file sharing.
7. Maintain file metadata separately from actual file contents.
8. Provide administrative interfaces for managing users, warehouses, and files.
9. Maintain file verification information and access-control records.
10. Design the architecture to support future integration with S3-compatible object storage.

---

## 3. Key Features

### 3.1 Warehouse-Based Storage

VaultFS organizes files into logical warehouses rather than storing all files in one common directory.

Each warehouse contains:

- Unique warehouse ID.
- Warehouse name.
- Description or notes.
- Creation timestamp.
- Associated API keys.
- Stored file records.

A user can access only the warehouses assigned to them, subject to their role and permissions.

### 3.2 File Upload

The system supports single and multiple file uploads through the web interface and API.

Features include:

- Multipart file upload.
- Warehouse-specific file organization.
- Unique stored filenames.
- Original filename preservation.
- File size and MIME-type tracking.
- Uploader information.
- Upload timestamps.
- Metadata registration after upload.

Files are organized using the following storage structure:

```text
uploads/
├── warehouse-id-1/
│   ├── timestamp-random-file1.pdf
│   └── timestamp-random-file2.jpg
│
└── warehouse-id-2/
    └── timestamp-random-file3.png
```

### 3.3 File Download

Users can retrieve files from warehouses they are authorized to access.

The download mechanism supports:

- Session-authenticated downloads.
- Signed URL-based downloads.
- Warehouse access validation.
- File existence checks.
- Binary file streaming.
- Appropriate content-type and content-disposition headers.

### 3.4 File Deletion

The system supports file deletion with authorization checks.

- Regular users can delete their own uploaded files within accessible warehouses.
- Admins and SuperAdmins can delete files across warehouses.
- The physical file and its associated metadata record are removed in the documented implementation.

### 3.5 File Metadata Management

VaultFS maintains metadata separately from the actual file contents.

Each file record contains information such as:

| Field        | Description                                 |
| ------------ | ------------------------------------------- |
| id           | Unique file identifier                      |
| warehouseId  | Associated warehouse                        |
| filename     | Actual stored filename                      |
| originalName | Original uploaded filename                  |
| uploadedAt   | Upload timestamp                            |
| uploader     | User who uploaded the file                  |
| size         | File size in bytes                          |
| mimeType     | File MIME type                              |
| isVerified   | Verification status                         |
| verifiedBy   | User or system responsible for verification |
| verifiedAt   | Verification timestamp                      |

### 3.6 File Verification

Administrators can verify or unverify files.

The system maintains:

- Verification status.
- Verifier identity.
- Verification timestamp.

This helps administrators identify files that have passed the required verification process.

### 3.7 API Key Management

VaultFS supports API-key authentication for external applications.

Each API key is associated with a particular warehouse.

Capabilities include:

- API key generation.
- Warehouse association.
- API key validation.
- Last-used timestamp tracking.
- API key revocation through the management design.

API keys are supplied through the `X-API-Key` HTTP header.

### 3.8 Signed URLs

The system provides temporary signed URLs for controlled file access.

Signed URLs use HMAC-SHA256 signatures.

The signature is generated using:

- Warehouse ID.
- Filename.
- Expiration timestamp.
- Secret signing key.

The documented implementation supports a configurable expiration period capped at 24 hours.

During validation, the system checks the expiration time and recomputes the signature using a timing-safe comparison.

### 3.9 Administrative Dashboard

The administrative interface provides functionality for:

- Creating and managing users.
- Creating warehouses.
- Generating API keys.
- Viewing warehouse information.
- Listing stored files.
- Verifying files.
- Managing system resources.

### 3.10 User Dashboard

The user interface provides:

- Warehouse selection.
- File upload.
- File listing.
- File download.
- Signed URL generation.
- File deletion.
- File statistics.
- API documentation.
- API testing interface.

---

## 4. User Roles and Permissions

VaultFS implements three primary roles through Role-Based Access Control.

| Feature                       | SuperAdmin | Admin | User |
| ----------------------------- | :--------: | :---: | :--: |
| Create Admin users            |    Yes    |  No  |  No  |
| Create regular users          |    Yes    |  Yes  |  No  |
| Create warehouses             |    Yes    |  Yes  |  No  |
| Generate API keys             |    Yes    |  Yes  |  No  |
| View all users                |    Yes    |  Yes  |  No  |
| View all warehouses           |    Yes    |  Yes  |  No  |
| View all files                |    Yes    |  Yes  |  No  |
| Verify files                  |    Yes    |  Yes  |  No  |
| Upload to any warehouse       |    Yes    |  Yes  |  No  |
| Upload to assigned warehouses |    Yes    |  Yes  | Yes |
| View accessible files         |    Yes    |  Yes  | Yes |
| Delete any file               |    Yes    |  Yes  |  No  |
| Delete own uploads            |    Yes    |  Yes  | Yes |
| Generate signed URLs          |    Yes    |  Yes  | Yes |
| Access Admin Dashboard        |    Yes    |  Yes  |  No  |
| Access User Dashboard         |    Yes    |  Yes  | Yes |

### SuperAdmin

The SuperAdmin has the highest level of system privileges.

Responsibilities:

- Manage administrators and regular users.
- Create and manage warehouses.
- Manage system-level resources.
- View audit and management information.

### Admin

Admins manage the day-to-day operation of the file management system.

Responsibilities:

- Create regular users.
- Manage warehouses.
- Generate API keys.
- View and manage files.
- Verify uploaded files.

### User

Regular users have restricted access based on their assigned warehouses.

Responsibilities:

- Log in to the platform.
- Upload files.
- View accessible files.
- Download files.
- Generate signed URLs.
- Delete their own uploads.

---

## 5. Technology Stack

The documented prototype uses the following technologies.

| Layer                  | Technology              | Purpose                       |
| ---------------------- | ----------------------- | ----------------------------- |
| Framework              | Next.js 14 (App Router) | Full-stack application        |
| Language               | TypeScript 5.3          | Type safety                   |
| Frontend               | React                   | User interface                |
| Styling                | Tailwind CSS 3.4        | Responsive styling            |
| Animations             | Framer Motion           | UI animations                 |
| Password Hashing       | bcryptjs                | Password hashing              |
| Session Authentication | jose                    | JWT session management        |
| Legacy JWT Support     | jsonwebtoken            | Legacy token utilities        |
| Cryptography           | Node.js Crypto          | AES-GCM, HMAC-SHA256, SHA-256 |
| Metadata Storage       | JSON                    | Persistent metadata           |
| File Storage           | Local Filesystem        | Actual file contents          |
| Notifications          | react-hot-toast         | UI notifications              |

### Storage Architecture

The current documented prototype uses two separate persistence locations:

```text
Project
│
├── storage/
│   └── metadata.json
│
└── uploads/
    ├── warehouse-1/
    │   └── files...
    │
    └── warehouse-2/
        └── files...
```

`metadata.json` stores users, warehouses, API keys, and file records.

The `uploads/` directory stores the actual binary file contents.

**Planned storage evolution:** The original project objective includes S3-compatible object storage. The current local-filesystem implementation provides the prototype storage backend; S3-compatible storage is a planned extension, not something this documentation claims is already operational.

---

## 6. System Architecture

The system follows a modular full-stack architecture.

```text
                 CLIENT / BROWSER
                        |
          +-------------+-------------+
          |                           |
     Admin Dashboard              User Dashboard
          |                           |
          +-------------+-------------+
                        |
                  Next.js APIs
                        |
                 Middleware Layer
                        |
          +-------------+-------------+
          |             |             |
       Auth API      Admin API     File APIs
          |             |             |
          +-------------+-------------+
                        |
                   Core Libraries
                        |
       +----------------+----------------+
       |                |                |
   session.ts       security.ts       storage.ts
       |                |                |
   JWT Sessions     HMAC / Hashing    Metadata CRUD
       |                |                |
       +----------------+----------------+
                        |
                 Persistence Layer
                        |
              +---------+---------+
              |                   |
         metadata.json          uploads/
         (Metadata)           (File Contents)
```

### Core Modules

| Module            | Responsibility                                     |
| ----------------- | -------------------------------------------------- |
| `types.ts`      | TypeScript interfaces and data models              |
| `storage.ts`    | Metadata read/write and CRUD operations            |
| `session.ts`    | JWT session creation, validation, and deletion     |
| `security.ts`   | Password hashing, token utilities, and signed URLs |
| `encryption.ts` | Cryptographic utilities                            |
| `rateLimit.ts`  | Request rate limiting                              |
| `utils.ts`      | Shared utility functions                           |

---

## 7. Project Structure

The documented repository follows this general structure:

```text
file-management-system/
│
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   └── v2/
│   │   │       ├── login/
│   │   │       ├── logout/
│   │   │       └── me/
│   │   │
│   │   ├── admin/
│   │   │   ├── create-api/
│   │   │   ├── create-user/
│   │   │   ├── list-apis/
│   │   │   ├── list-files/
│   │   │   ├── list-users/
│   │   │   ├── list-warehouses/
│   │   │   └── verify-file/
│   │   │
│   │   ├── upload/
│   │   ├── signed-url/
│   │   │
│   │   ├── files/
│   │   │   └── [warehouse]/
│   │   │       └── [...file]/
│   │   │
│   │   └── user/
│   │       ├── files/
│   │       └── warehouses/
│   │
│   ├── lib/
│   │   ├── types.ts
│   │   ├── storage.ts
│   │   ├── session.ts
│   │   ├── security.ts
│   │   ├── encryption.ts
│   │   ├── rateLimit.ts
│   │   └── utils.ts
│   │
│   ├── components/
│   │   └── ui/
│   │       └── file-upload.tsx
│   │
│   ├── admin/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── login/
│   │   ├── users/
│   │   └── warehouses/
│   │
│   ├── user/
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   ├── docs/
│   │   ├── test/
│   │   └── debug/
│   │
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
│
├── scripts/
│   └── init-storage.js
│
├── storage/
│   └── metadata.json
│
├── uploads/
│   └── {warehouseId}/
│
├── middleware.ts
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── .env.local
```

---

## 8. Data Models

The system maintains four primary metadata models.

### User

```typescript
interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'superadmin' | 'admin' | 'user';
  warehouseIds?: string[];
  name?: string;
  createdAt?: string;
}
```

### Warehouse

```typescript
interface Warehouse {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
}
```

### ApiKey

```typescript
interface ApiKey {
  key: string;
  warehouseId: string;
  createdAt: string;
  lastUsed?: string;
}
```

### StoredFile

```typescript
interface StoredFile {
  id: string;
  warehouseId: string;
  filename: string;
  originalName: string;
  uploadedAt: string;
  uploader: string;
  size: number;
  mimeType: string;
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
}
```

### Metadata Root Structure

```typescript
interface Metadata {
  users: User[];
  warehouses: Warehouse[];
  apiKeys: ApiKey[];
  files: StoredFile[];
}
```

---

## 9. Authentication and Authorization

VaultFS uses two primary authentication mechanisms.

### 9.1 Session-Based Authentication

Session authentication is used for web application access.

The login process:

1. User submits email and password.
2. The backend searches for the user in metadata.
3. The submitted password is verified against the stored hash.
4. A JWT session token is generated.
5. The token is stored in an HTTP-only cookie.
6. The session is validated on protected requests.

Documented session characteristics:

- JWT-based session.
- HS256 signing.
- Eight-hour session lifetime.
- HTTP-only cookie.
- SameSite Lax configuration.

### 9.2 API-Key Authentication

API keys are intended for programmatic integration.

The client sends:

```http
X-API-Key: YOUR_API_KEY
```

The server:

1. Reads the API key from the request header.
2. Validates the key against stored API-key records.
3. Identifies the warehouse associated with the key.
4. Allows or rejects the operation based on the key and warehouse association.

The documented upload endpoint supports API-key or session-based authentication.

### 9.3 Role-Based Authorization

Authorization is enforced according to user roles and warehouse assignments.

- SuperAdmin: system-wide management access.
- Admin: administrative file and warehouse operations.
- User: restricted access to assigned warehouses and own uploads.

---

## 10. Security Mechanisms

### Password Hashing

The documented implementation supports password verification using bcrypt and a legacy salted SHA-256 format for backward compatibility.

New password storage should use bcrypt rather than the legacy SHA-256 mechanism.

### Signed URL Security

Signed URLs use HMAC-SHA256.

Conceptually:

```text
Input:
  warehouseId
  filename
  expiry timestamp

String to sign:
  warehouseId/filename?expires=timestamp

Signature:
  HMAC-SHA256(secret, stringToSign)
```

The server validates the signature and expiration before allowing access through a signed URL.

### Transport Encryption

The code documentation describes AES-256-GCM utilities for encrypted payloads.

**Important security note:** the documented transport-encryption payload includes its encryption key. Therefore, it does not provide confidentiality against an observer who can read the complete payload. Production transport security should rely on HTTPS and a properly designed key-management or public-key encryption mechanism.

### Rate Limiting

The prototype uses an in-memory rate limiter.

The documented limits are:

| Category         |  Limit | Time Window |
| ---------------- | -----: | ----------- |
| Authentication   |  1,000 | 1 minute    |
| File Upload      | 10,000 | 1 hour      |
| Download         | 10,000 | 1 minute    |
| Admin Operations |    500 | 1 minute    |

These are prototype configuration values, not recommended production limits. An in-memory limiter is also not shared across multiple server instances.

---

## 11. API Documentation

The following endpoints are documented in the implementation.

### Authentication APIs

| Method | Endpoint                | Description                  |
| ------ | ----------------------- | ---------------------------- |
| POST   | `/api/auth/v2/login`  | Authenticate a user          |
| POST   | `/api/auth/v2/logout` | End the session              |
| GET    | `/api/auth/v2/me`     | Get current user information |

### Admin APIs

| Method | Endpoint                       | Description                  |
| ------ | ------------------------------ | ---------------------------- |
| POST   | `/api/admin/create-api`      | Create warehouse and API key |
| POST   | `/api/admin/create-user`     | Create a user                |
| GET    | `/api/admin/list-users`      | List users                   |
| GET    | `/api/admin/list-warehouses` | List warehouses              |
| GET    | `/api/admin/list-apis`       | List API keys                |
| GET    | `/api/admin/list-files`      | List files                   |
| POST   | `/api/admin/verify-file`     | Verify or unverify a file    |

### File APIs

| Method | Endpoint                              | Description                  |
| ------ | ------------------------------------- | ---------------------------- |
| POST   | `/api/upload`                       | Upload one or multiple files |
| POST   | `/api/signed-url`                   | Generate a signed URL        |
| GET    | `/api/files/{warehouse}/{filename}` | Retrieve a file              |

### User APIs

| Method | Endpoint                     | Description                |
| ------ | ---------------------------- | -------------------------- |
| GET    | `/api/user/files`          | List accessible files      |
| DELETE | `/api/user/files/{fileId}` | Delete a file              |
| GET    | `/api/user/warehouses`     | List accessible warehouses |

### Example: File Upload

Request:

```http
POST /api/upload
Content-Type: multipart/form-data
X-API-Key: YOUR_API_KEY
```

Form data:

```text
file: document.pdf
warehouseId: warehouse-id
```

Example response:

```json
{
  "success": true,
  "count": 1,
  "files": [
    {
      "fileId": "f-example",
      "filename": "timestamp-random-document.pdf",
      "originalName": "document.pdf",
      "size": 102400
    }
  ]
}
```

### Example: Generate Signed URL

Request:

```http
POST /api/signed-url
```

```json
{
  "warehouseId": "w-123",
  "filename": "document.pdf",
  "expiresIn": 3600
}
```

Example response:

```json
{
  "signedUrl": "https://example.com/api/files/w-123/document.pdf?expires=...&signature=..."
}
```

The example domain and identifiers are placeholders.

---

## 12. File Upload Workflow

The upload process follows these steps:

1. Client selects one or more files.
2. Client provides the target warehouse.
3. Request reaches the upload API.
4. Rate limiting is checked.
5. The server validates the API key or user session.
6. Warehouse access is checked.
7. The warehouse-specific storage directory is created if necessary.
8. A unique stored filename is generated.
9. The file is written to the filesystem.
10. File metadata is registered in `metadata.json`.
11. The API returns the upload result.

```text
Client
  |
  v
Upload API
  |
  v
Authentication
  |
  v
Warehouse Authorization
  |
  v
File Validation
  |
  v
Generate Unique Filename
  |
  v
Write File to Storage
  |
  v
Save Metadata
  |
  v
Return Upload Response
```

---

## 13. File Download Workflow

The download workflow supports session-based and signed URL access.

```text
Client Requests File
        |
        v
File API
        |
        v
Find File Metadata
        |
        v
Check Access Method
        |
        +----------------------+
        |                      |
    Signed URL             Session
        |                      |
    Verify HMAC            Verify JWT
        |                      |
    Check Expiry          Check Role
        |                      |
        +----------+-----------+
                   |
                   v
            Authorization
                   |
                   v
          Read File from Disk
                   |
                   v
          Stream File Response
```

Invalid or expired signed URLs are rejected.

---

## 14. Data Flow and UML Documentation

The system has also been documented using software engineering diagrams.

### Data Flow Diagrams

Three DFD levels are used to describe the system:

- Level 0: Shows the complete FMS as one process and its interaction with the Admin and User.
- Level 1: Describes major processes such as file retrieval, upload, file processing, dockyard management, and user management, together with their data stores.
- Level 2: Further decomposes a selected process into detailed subprocesses.

### Class Diagram

The class diagram represents the structural design of the system, including:

- User
- Admin
- SuperAdmin
- Warehouse
- ApiKey
- Session
- StoredFile
- SignedURL

It describes the attributes, methods, and relationships between these components.

### Object Diagram

The object diagram shows example instances of the system's classes, such as:

- `superAdmin1`
- `faculty1`
- `student1`
- `academicWH`
- `apiKey1`
- `file1`
- `file2`
- `session1`
- `signedUrl1`

These diagrams help explain the architecture and data relationships of VaultFS.

---

## 15. Installation and Local Setup

### Prerequisites

- Node.js
- npm
- Git
- A compatible development environment

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd file-management-system
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

Create a `.env.local` file in the project root.

```env
NODE_ENV=development

NEXT_PUBLIC_BASE_URL=http://localhost:3000

JWT_SECRET=replace-with-a-secure-random-secret
SESSION_SECRET=replace-with-a-secure-random-secret-of-at-least-32-characters
HMAC_SECRET=replace-with-a-secure-random-secret
```

Use independent, randomly generated secrets. Never commit `.env.local` or production credentials to version control.

### Step 4: Initialize Storage

The documented initialization script is:

```bash
npm run init
```

It initializes the storage directories and metadata file and seeds the initial administrator account.

The actual initial login credentials should be obtained securely from the project's setup configuration rather than committed to this README.

### Step 5: Start Development Server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

**Note:** Verify the available scripts in `package.json` before running commands. The initialization and development commands above follow the documented project setup.

---

## 16. Current Implementation and Planned Enhancements

The project began with the objective of building a reusable, secure file-management microservice. The current prototype implements the core file-management workflow and associated administrative interfaces.

### Documented Prototype Capabilities

- Next.js-based full-stack application.
- Warehouse-based file organization.
- Local filesystem file storage.
- JSON-based metadata persistence.
- User, Admin, and SuperAdmin roles.
- Session-based authentication.
- API-key authentication for uploads.
- File upload and download.
- File deletion.
- Signed URL generation and validation.
- File metadata tracking.
- File verification.
- Administrative and user dashboards.
- API documentation and testing interface.
- In-memory rate limiting.

### Planned / Future Enhancements

The following items represent the broader project direction and should not be interpreted as already completed features:

1. **S3-Compatible Object Storage:** Introduce a storage abstraction that supports Amazon S3 and other S3-compatible providers.
2. **Database Migration:** Replace the single JSON metadata file with a transactional database for reliable concurrent operations.
3. **Distributed Rate Limiting:** Move in-memory rate limiting to a shared service such as Redis.
4. **Improved Cryptographic Design:** Introduce production-grade key management and secure transport practices.
5. **Audit Logging:** Maintain detailed records of administrative actions and file operations.
6. **Scalable File Handling:** Improve support for large files and concurrent uploads.
7. **Background Processing:** Move expensive file operations and cleanup tasks into background workers.
8. **Storage Abstraction:** Separate business logic from the underlying storage provider.
9. **Production Deployment:** Add monitoring, backup, recovery, and deployment automation.
10. **Improved API Integration:** Expand support for independent applications consuming VaultFS as a shared file service.

---

## 17. Known Limitations and Production Considerations

The current prototype is suitable for demonstrating the core architecture and file-management workflows. It should not be considered production-ready without further engineering.

Important limitations identified in the implementation documentation include:

- JSON metadata storage does not provide database transactions or reliable concurrent writes.
- The local filesystem is not equivalent to distributed object storage.
- In-memory rate limiting is not shared across multiple application instances.
- API keys do not have an automatic expiry mechanism in the documented implementation.
- The documented transport-encryption payload exposes its encryption key and therefore requires redesign.
- Production deployments need HTTPS, secure cookie settings, secret management, backups, and appropriate monitoring.
- File validation, upload limits, path safety, and authorization must be reviewed before exposing the service publicly.
- Production deployment requires a persistent storage strategy and recovery procedures.

---

## 18. Project Management and Development Scope

The academic project plan estimated:

- **Prototype development:** Approximately 3 months.
- **Full-development and deployment estimate:** Approximately 11 months.
- **Estimated project size:** Approximately 12–15 KLOC.

These are planning estimates from the SPMP, not claims about actual elapsed development time.

The planned development areas include:

- Frontend and administrative portal.
- Backend APIs and business logic.
- Authentication and security.
- Storage and metadata management.
- Background workers and cleanup.
- Testing and deployment.

---

## 19. Conclusion

VaultFS is designed as a centralized, modular file management platform that provides warehouse-based storage, controlled access, and API-driven file operations.

The prototype demonstrates the major components required for a reusable file management service, including role-based access control, session authentication, API-key authentication, file upload and download, metadata management, verification, and signed URLs.

Its modular architecture establishes a foundation for future integration with S3-compatible object storage, database-backed metadata management, distributed rate limiting, and production-scale deployment.

The long-term goal is to make VaultFS a reusable storage service that can be integrated into multiple independent applications through a consistent and secure API.

---

## 20. License

Add the project's chosen license here before making the repository publicly available.

## 21. Contributors

Add the project contributors and their respective responsibilities here.
