# GIREAPP Backend API Documentation

This document outlines the available REST API endpoints for the GIREAPP Backend, providing details on request/response structures, validation, and crucial security expectations for frontend integration.

## Base URL
All API requests should be prefixed with `/api` and directed to the backend host (e.g., `http://localhost:8000/api` for local development).

## Security & Authentication 🔒 (Mandatory for Frontend Devs)
* **JWT Authorization (Cookies):** Authentication uses **HTTP-Only, Secure cookies**. The JWT is set automatically on login and passed automatically on subsequent requests. You MUST include `credentials: 'include'` in all your `fetch` or `axios` requests to protected endpoints.
* **Fallback Authorization:** The API still accepts `Authorization: Bearer <token>` headers as a fallback, but cookies are the primary and most secure method.
* **Rate Limiting:** Auth endpoints are strictly rate-limited (10 requests / 15 minutes) to prevent brute force attacks. All other APIs have a global limit (100 requests / 15 minutes).
* **Data Privacy:** User data (especially academic records and PII) is highly sensitive. The frontend must never cache sensitive data insecurely or expose tokens in URLs or local storage without encryption/secure boundaries.
* **Input Validation:** All user inputs must be sanitised before transmission, though the backend implements strict threat detection (e.g., against XSS/SQLi) and Zod schema validation.

---

## 1. Health Check

### `GET /api/health`
Basic endpoint to check if the backend service is running.

**Response:** `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2026-06-29T11:30:00.000Z"
}
```

---

## 2. Authentication

### `POST /api/auth/register`
Creates a new user account. If the signup wizard's `track` and `department` are provided, the onboarding selection is persisted (`track` maps `Secondary→SECONDARY`, `Tertiary→TERTIARY`, `Professional→PROFESSIONAL`). Registration is **auto-login**: the response sets the `token` cookie and returns the JWT in the body, same shape as login.

**Request Body:**
```json
{
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "password": "SecurePassword1",
  "confirmPassword": "SecurePassword1",
  "track": "Secondary",
  "department": "Science",
  "level": "SS2",
  "focusArea": "Physics"
}
```
`track`, `department`, `level`, and `focusArea` are optional. `level` and `focusArea` are currently accepted but not persisted.

**Success Response:** `201 Created`
*(The JWT is also set in an `HttpOnly` cookie named `token`)*
```json
{
  "message": "Account created successfully.",
  "user": {
    "id": "cuid-string",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "STUDENT",
    "academicLevel": "SECONDARY",
    "department": "Science",
    "moodTheme": "calm",
    "points": 0,
    "image": null,
    "isOnboardingComplete": true
  },
  "token": "<jwt>"
}
```

**Error Responses:**
* `400 Bad Request`: Suspicious input detected (threat blocker).
* `409 Conflict`: An account with this email already exists.
* `422 Unprocessable Entity`: Validation failed (e.g., weak password, invalid email format). Body is `{ "error": "...", "errors": { "<field>": ["..."] } }`.

### `POST /api/auth/login`
Authenticates a user and returns a JWT along with the user's profile.

**Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "password": "SecurePassword1"
}
```

**Success Response:** `200 OK`
*(The JWT is set in an `HttpOnly` cookie named `token` and also returned in the body — cross-origin frontends read `token` from the body and set their own cookie)*
```json
{
  "user": {
    "id": "cuid-string",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "STUDENT",
    "academicLevel": "SECONDARY",
    "department": "Science",
    "moodTheme": "calm",
    "points": 150,
    "image": "url-to-avatar",
    "isOnboardingComplete": true
  },
  "token": "<jwt>"
}
```

**Error Responses:**
* `401 Unauthorized`: Invalid email or password (unified message — no user enumeration).
* `403 Forbidden`: Email address not verified.
* `422 Unprocessable Entity`: Validation failed.

### `POST /api/auth/logout`
Logs out a user by immediately expiring the authentication cookie.

**Success Response:** `200 OK`
```json
{
  "message": "Logged out successfully"
}
```

### `GET /api/auth/me`
Returns the current user's profile, fetched fresh from the database (not just decoded from the token).
*Requires Authentication*

**Success Response:** `200 OK`
```json
{
  "id": "cuid-string",
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "role": "STUDENT",
  "academicLevel": "SECONDARY",
  "department": "Science",
  "moodTheme": "calm",
  "points": 150,
  "image": null,
  "isOnboardingComplete": true
}
```

**Error Responses:**
* `401 Unauthorized`: Missing/invalid token, or the account no longer exists.

### `POST /api/auth/forgot-password`
Requests a password reset link. **Always returns `200`**, whether or not the email exists (enumeration-safe). When the account exists, a single-use reset token (valid for 1 hour) is emailed via Resend.

**Request Body:**
```json
{
  "email": "jane.doe@example.com"
}
```

**Success Response:** `200 OK`
```json
{
  "message": "If an account exists for that email, a reset link has been sent."
}
```

**Error Responses:**
* `422 Unprocessable Entity`: Invalid email format.

### `POST /api/auth/reset-password`
Sets a new password using the token from the reset email. Tokens are single-use and expire after 1 hour.

**Request Body:**
```json
{
  "token": "<token-from-email>",
  "password": "NewPassword1",
  "confirmPassword": "NewPassword1"
}
```

**Success Response:** `200 OK`
```json
{
  "message": "Password reset successfully. You can now log in."
}
```

**Error Responses:**
* `422 Unprocessable Entity`: Validation failed, or the reset token is invalid/expired/already used.

### `POST /api/auth/verify-email`
Verifies a user's email address using the token from the verification email. Tokens are single-use and expire after 24 hours.

**Request Body:**
```json
{
  "token": "<token-from-email>"
}
```

**Success Response:** `200 OK`
```json
{
  "message": "Email verified successfully. You can now log in."
}
```

**Error Responses:**
* `400 Bad Request`: Missing token, or the verification token is invalid/expired.

### `POST /api/auth/onboarding`
Saves the user's onboarding selection and **re-issues the JWT** with updated claims (`academicLevel`, `department`, `isOnboardingComplete`). The frontend should replace its stored session token with the returned one.
*Requires Authentication*

**Request Body:**
```json
{
  "academicLevel": "TERTIARY",
  "department": "Undergraduate",
  "moodTheme": "focused"
}
```
`department` must belong to the chosen `academicLevel` (`SECONDARY`: Science/Business/Arts, `TERTIARY`: Undergraduate/Postgraduate, `PROFESSIONAL`: Data Analytics/Project Management/Digital Marketing/Software Engineering). `moodTheme` is one of `calm`, `focused`, `energized`, `relaxed` (defaults to `calm`).

**Success Response:** `200 OK`
*(The refreshed JWT is also set in the `token` cookie)*
```json
{
  "user": {
    "id": "cuid-string",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "STUDENT",
    "academicLevel": "TERTIARY",
    "department": "Undergraduate",
    "moodTheme": "focused",
    "points": 150,
    "image": null,
    "isOnboardingComplete": true
  },
  "token": "<refreshed-jwt>"
}
```

**Error Responses:**
* `401 Unauthorized`: Missing or invalid token.
* `422 Unprocessable Entity`: Validation failed (e.g., department doesn't match the academic level).

---

## 3. Dashboard

### `GET /api/dashboard`
Returns everything the dashboard renders: the user's profile, gamification stats, enrolled courses, and recent activity. For a brand-new user this is the first-time empty state (`totalPoints: 0`, `badgeCount: 0`, empty arrays) with a populated `profile`.
*Requires Authentication*

**Success Response:** `200 OK` — the shared `DashboardOverview` type
```json
{
  "profile": {
    "id": "cuid-string",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "STUDENT",
    "academicLevel": "SECONDARY",
    "department": "Science",
    "moodTheme": "calm",
    "points": 0,
    "image": null,
    "isOnboardingComplete": true
  },
  "totalPoints": 0,
  "badgeCount": 0,
  "activeCourses": [
    {
      "id": "course-id",
      "title": "Foundations of Physics: Mechanics",
      "description": "Master the basics of motion, forces, and energy.",
      "thumbnailUrl": null,
      "moduleCount": 1,
      "lessonCount": 2,
      "progress": 0.25,
      "estimatedMinutes": 25
    }
  ],
  "recentActivity": [
    {
      "id": "activity-id",
      "type": "lesson_completed",
      "title": "Introduction to Motion",
      "timestamp": "2026-07-12T16:03:58.917Z"
    }
  ]
}
```
`activeCourses` lists the user's enrolments in published courses (`progress` is 0.0–1.0). `recentActivity` is the 10 most recent events across lesson completions, quiz attempts (`quiz_passed`/`quiz_failed`, with `metadata.score`), badges earned (`badge_earned`), and enrolments (`course_enrolled`), newest first.

**Error Responses:**
* `401 Unauthorized`: Missing/invalid token, or the account no longer exists.

---

## 4. Courses

### `GET /api/courses/:courseId/lessons/:lessonId`
Fetches a specific lesson, its parent module, and progress/pagination data.
*Requires Authentication*

**Credentials Required:**
Ensure your frontend request includes `credentials: 'include'` so the browser sends the HTTP-only `token` cookie. Alternatively, you can pass an `Authorization: Bearer <your-jwt-token>` header.

**Success Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "lesson": {
      "id": "lesson-id",
      "title": "Introduction to Algebra",
      "content": "...",
      "moduleId": "module-id",
      "order": 1
    },
    "nextLessonId": "next-lesson-id",
    "prevLessonId": null,
    "module": {
      "id": "module-id",
      "title": "Module 1: Basics",
      "courseId": "course-id",
      "order": 1
    },
    "allLessonsCount": 10,
    "currentIndex": 0,
    "isCompleted": false
  }
}
```

**Error Responses:**
* `401 Unauthorized`: Missing or invalid JWT.
* `403 Forbidden`: User is not enrolled in the course, or the course is unpublished.
* `404 Not Found`: Lesson ID not found in the course.
