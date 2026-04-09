# Nutrition Tracker (Full-Stack)

A beginner-friendly nutrition tracker that:
- Parses free-text meals with OpenAI (structure only)
- Looks up nutrition from USDA FoodData Central (nutrition values)
- Lets users review/edit item nutrition before saving
- Stores confirmed meals in browser local storage

## Architecture

- `index.html`, `style.css`, `script.js`: frontend (plain HTML/CSS/JS)
- `server.js`: backend API (Node.js + Express)
- `POST /api/analyze-meal`: parse + nutrition enrichment endpoint

## Security

API keys are backend-only via environment variables. The frontend never receives OpenAI or USDA keys.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and set keys.
3. Start server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`.

## API Contract

### Request
`POST /api/analyze-meal`

```json
{
  "mealDescription": "2 eggs, toast with butter"
}
```

### Response

```json
{
  "parsedMeal": {
    "meal_name": "Breakfast",
    "items": [{ "food": "egg", "amount": 2, "unit": "serving" }]
  },
  "itemsWithNutrition": [
    {
      "food": "egg",
      "amount": 2,
      "unit": "serving",
      "calories": 140,
      "protein": 12,
      "carbs": 1,
      "fat": 10,
      "source": "USDA (...)"
    }
  ],
  "totals": {
    "calories": 140,
    "protein": 12,
    "carbs": 1,
    "fat": 10
  }
}
```

## Deployment Notes

- Frontend is static and can be hosted on GitHub Pages.
- Backend can be deployed separately to Render, Vercel, Fly.io, etc.
- When frontend and backend are on different domains, set the backend URL in the UI's "Backend API base URL" field.
