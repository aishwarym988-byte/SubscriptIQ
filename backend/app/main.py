from fastapi import FastAPI

app = FastAPI(
    title="SubscriptIQ API",
    description="SaaS Subscription Management System",
    version="1.0.0",
)


@app.get("/")
def home():
    return {
        "message": "Welcome to SubscriptIQ",
        "status": "Backend is running",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}