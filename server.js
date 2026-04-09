const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
}

function scoreMatch(query, candidate) {
    const queryTokens = tokenize(query);
    const candidateTokens = tokenize(candidate);
    const tokenSet = new Set(candidateTokens);
    const overlap = queryTokens.filter((t) => tokenSet.has(t)).length;

    let score = overlap;
    if (candidate.toLowerCase() === query.toLowerCase()) score += 3;
    if (candidate.toLowerCase().includes(query.toLowerCase())) score += 1;
    return score;
}

function nutrientValue(food, nutrientNumber, fallbackName) {
    const nutrient = (food.foodNutrients || []).find((item) => {
        const number = String(item.nutrientNumber || "");
        const name = String(item.nutrientName || "").toLowerCase();
        return number === nutrientNumber || name.includes(fallbackName);
    });
    return Number(nutrient?.value || 0);
}

function unitToGrams(unit, amount) {
    const clean = String(unit || "").toLowerCase();
    if (clean === "g" || clean === "gram" || clean === "grams") return amount;
    if (clean === "oz" || clean === "ounce" || clean === "ounces") return amount * 28.3495;
    return null;
}

function scaleByAmount(food, item) {
    const amount = Number(item.amount || 1);
    const servingSize = Number(food.servingSize || 0);
    const servingUnit = String(food.servingSizeUnit || "").toLowerCase();

    if (servingSize > 0) {
        const grams = unitToGrams(item.unit, amount);
        if (grams && servingUnit === "g") {
            return grams / servingSize;
        }
    }

    if (String(item.unit || "").toLowerCase().startsWith("serv")) {
        return amount;
    }

    return amount;
}

async function parseMealWithOpenAi(mealDescription) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("Missing OPENAI_API_KEY");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            temperature: 0,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "meal_items",
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            meal_name: { type: "string" },
                            items: {
                                type: "array",
                                minItems: 1,
                                items: {
                                    type: "object",
                                    additionalProperties: false,
                                    properties: {
                                        food: { type: "string" },
                                        amount: { type: "number" },
                                        unit: { type: "string" }
                                    },
                                    required: ["food", "amount", "unit"]
                                }
                            }
                        },
                        required: ["meal_name", "items"]
                    }
                }
            },
            messages: [
                {
                    role: "system",
                    content:
                        "You extract food items from meals. Return strict JSON. If amount is unknown, use 1. Use practical units like serving, grams, oz, cup, tbsp."
                },
                { role: "user", content: mealDescription }
            ]
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI request failed (${response.status})`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return JSON.parse(content);
}

async function usdaSearch(foodName) {
    if (!process.env.USDA_API_KEY) {
        throw new Error("Missing USDA_API_KEY");
    }

    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("api_key", process.env.USDA_API_KEY);
    url.searchParams.set("query", foodName);
    url.searchParams.set("pageSize", "8");

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`USDA request failed (${response.status})`);
    }

    const data = await response.json();
    return data.foods || [];
}

async function analyzeItem(item) {
    const usdaFoods = await usdaSearch(item.food);
    const sorted = [...usdaFoods].sort(
        (a, b) => scoreMatch(item.food, b.description || "") - scoreMatch(item.food, a.description || "")
    );
    const best = sorted[0];

    if (!best) {
        return {
            food: item.food,
            amount: item.amount,
            unit: item.unit,
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            source: "No USDA match"
        };
    }

    const factor = scaleByAmount(best, item);

    const calories = nutrientValue(best, "1008", "energy") * factor;
    const protein = nutrientValue(best, "1003", "protein") * factor;
    const carbs = nutrientValue(best, "1005", "carbohydrate") * factor;
    const fat = nutrientValue(best, "1004", "lipid") * factor;

    const source = `USDA (${best.description})`;

    return {
        food: item.food,
        amount: item.amount,
        unit: item.unit,
        calories,
        protein,
        carbs,
        fat,
        source
    };
}

app.post("/api/analyze-meal", async (req, res) => {
    try {
        const mealDescription = String(req.body?.mealDescription || "").trim();
        if (!mealDescription) {
            return res.status(400).json({ error: "mealDescription is required" });
        }

        const parsedMeal = await parseMealWithOpenAi(mealDescription);
        const items = Array.isArray(parsedMeal.items) ? parsedMeal.items : [];

        if (!items.length) {
            return res.status(422).json({ error: "Could not parse meal items" });
        }

        const itemsWithNutrition = await Promise.all(items.map((item) => analyzeItem(item)));

        const totals = itemsWithNutrition.reduce(
            (acc, item) => {
                acc.calories += item.calories;
                acc.protein += item.protein;
                acc.carbs += item.carbs;
                acc.fat += item.fat;
                return acc;
            },
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
        );

        return res.json({
            parsedMeal,
            itemsWithNutrition,
            totals
        });
    } catch (error) {
        return res.status(500).json({
            error: "Failed to analyze meal",
            detail: error.message
        });
    }
});

app.get("/api/health", (_, res) => {
    res.json({ ok: true, service: "nutrition-tracker-api" });
});

app.listen(PORT, () => {
    console.log(`Nutrition tracker listening on http://localhost:${PORT}`);
});
