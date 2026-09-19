
## API Routes

### Auth Routes (`/api/v1/auth`)

| Method | Route                    | Description                                              |
| ------ | ------------------------ | -------------------------------------------------------- |
| POST   | `/api/v1/auth/signup`  | Register a new user                                      |
| POST   | `/api/v1/auth/login`   | Log in and receive access + refresh tokens               |
| POST   | `/api/v1/auth/refresh` | Get a new access token using a refresh token             |
| GET    | `/api/v1/auth/me`      | Get current logged-in user (requires valid access token) |
| POST   | `/api/v1/auth/logout`  | Log out and invalidate refresh token                     |

### Internal Routes (`/api/v1/internal`)

| Method | Route                             | Description                                       |
| ------ | --------------------------------- | ------------------------------------------------- |
| POST   | `/api/v1/internal/verify-token` | Used by other services to verify a token is valid |

## Running with Docker

1. Make sure `.env.docker` is filled in with real values (not committed to git).
2. From the project root, run:

```bash
   docker compose up --build
```

3. The service will be available at `http://localhost:4001`.

To stop:

```bash
docker compose down
```

## Environment Variables

See `.env.example` for the full list. Required variables:

- `PORT` — port the service runs on (default: 4001)
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_ACCESS_SECRET` — secret used to sign access tokens
- `JWT_REFRESH_SECRET` — secret used to sign refresh tokens
- `NODE_ENV` — `development` | `production`
