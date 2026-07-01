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
Creates a new user account.

**Request Body:**
```json
{
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "password": "securePassword123!"
}
```

**Success Response:** `201 Created`
```json
{
  "message": "Account created successfully. You can now log in.",
  "user": {
    "id": "cuid-string",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "LEARNER",
    "createdAt": "2026-06-29T11:30:00.000Z"
  }
}
```

**Error Responses:**
* `400 Bad Request`: Suspicious input detected (threat blocker).
* `409 Conflict`: An account with this email already exists.
* `422 Unprocessable Entity`: Validation failed (e.g., weak password, invalid email format).

### `POST /api/auth/login`
Authenticates a user and returns a JWT along with the user's profile.

**Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "password": "securePassword123!"
}
```

**Success Response:** `200 OK`
*(The JWT is set in an `HttpOnly` cookie named `token`)*
```json
{
  "user": {
    "id": "cuid-string",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "LEARNER",
    "academicLevel": "SECONDARY",
    "department": "SCIENCE",
    "moodTheme": "LIGHT",
    "points": 150,
    "image": "url-to-avatar",
    "isOnboardingComplete": true
  }
}
```

### `POST /api/auth/logout`
Logs out a user by immediately expiring the authentication cookie.

**Success Response:** `200 OK`
```json
{
  "message": "Logged out successfully"
}
```

**Error Responses:**
* `401 Unauthorized`: Invalid email or password.
* `403 Forbidden`: Email address not verified.
* `422 Unprocessable Entity`: Validation failed.

---

## 3. Courses

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
