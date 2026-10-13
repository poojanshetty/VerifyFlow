from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.workflow import assign_unassigned_cases_on_startup, router as workflow_router
from .storage import initialize_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    assign_unassigned_cases_on_startup()
    yield

app = FastAPI(
    title="VerifyFlow API",
    description="Loan Verification and Field Operations API",
    version="0.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://127.0.0.1:8081"],
    allow_methods=["GET", "POST", "PATCH", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def prevent_private_data_caching(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response

app.include_router(workflow_router)


@app.get("/")
def root():
    return {"message": "VerifyFlow API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}