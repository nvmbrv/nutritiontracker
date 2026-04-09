document.addEventListener("DOMContentLoaded", () => {
    const foodForm = document.getElementById("foodForm");
    const foodTable = document.getElementById("foodTable");
    const foodSearch = document.getElementById("foodSearch");
    const foodSuggestions = document.getElementById("foodSuggestions");
    const useAiAssistInput = document.getElementById("useAiAssist");
    const openAiKeyInput = document.getElementById("openAiKey");
    const openAiModelInput = document.getElementById("openAiModel");
    const dateInput = document.getElementById("date");
    const timeInput = document.getElementById("time");
    const quantityInput = document.getElementById("quantity");
    const unitInput = document.getElementById("unit");

    const reviewPanel = document.getElementById("reviewPanel");
    const reviewFood = document.getElementById("reviewFood");
    const reviewCalories = document.getElementById("reviewCalories");
    const reviewProtein = document.getElementById("reviewProtein");
    const reviewCarbs = document.getElementById("reviewCarbs");
    const reviewFat = document.getElementById("reviewFat");
    const reviewSource = document.getElementById("reviewSource");
    const approveBtn = document.getElementById("approveBtn");
    const cancelBtn = document.getElementById("cancelBtn");

    const totalCalories = document.getElementById("totalCalories");
    const totalProtein = document.getElementById("totalProtein");
    const totalCarbs = document.getElementById("totalCarbs");
    const totalFat = document.getElementById("totalFat");

    const entries = [];
    let pendingEntry = null;
    let suggestions = [];

    const chart = new Chart(document.getElementById("trendChart"), {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Calories",
                    data: [],
                    borderColor: "#0f766e",
                    tension: 0.25,
                    fill: false
                },
                {
                    label: "Protein (g)",
                    data: [],
                    borderColor: "#7c3aed",
                    tension: 0.25,
                    fill: false
                }
            ]
        },
        options: {
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    const now = new Date();
    dateInput.value = now.toISOString().split("T")[0];
    timeInput.value = now.toTimeString().split(" ")[0].slice(0, 5);

    const formatNumber = (value, decimals = 1) => Number(value || 0).toFixed(decimals);

    function readTextFromChatCompletion(data) {
        return data?.choices?.[0]?.message?.content || "";
    }

    function parseJsonBlock(text) {
        const trimmed = text.trim();
        if (trimmed.startsWith("{")) {
            return JSON.parse(trimmed);
        }

        const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/({[\s\S]*})/);
        if (!jsonMatch) {
            throw new Error("Could not parse AI response.");
        }
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    }

    async function parseMealWithLlm(description, apiKey, model) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                temperature: 0.1,
                messages: [
                    {
                        role: "system",
                        content:
                            "Extract meal items into JSON only. Return: {\"items\":[{\"name\":\"string\",\"quantity\":number,\"unit\":\"grams|serving|cups|oz\"}]}. If uncertain use quantity 1 and unit serving."
                    },
                    {
                        role: "user",
                        content: description
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error("AI request failed.");
        }

        const data = await response.json();
        const text = readTextFromChatCompletion(data);
        const parsed = parseJsonBlock(text);

        if (!Array.isArray(parsed.items) || !parsed.items.length) {
            throw new Error("AI response contained no food items.");
        }

        return parsed.items.map((item) => ({
            name: String(item.name || "").trim(),
            quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
            unit: ["grams", "serving", "cups", "oz"].includes(item.unit) ? item.unit : "serving"
        })).filter((item) => item.name);
    }

    function setSuggestions(items) {
        foodSuggestions.innerHTML = "";
        items.slice(0, 8).forEach((item) => {
            const div = document.createElement("div");
            div.className = "suggestion-item";
            div.textContent = item.product_name;
            div.addEventListener("click", () => {
                foodSearch.value = item.product_name;
                foodSuggestions.innerHTML = "";
                suggestions = [];
            });
            foodSuggestions.appendChild(div);
        });
    }

    async function searchFoods(query) {
        const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Unable to search nutrition source.");
        }
        const data = await response.json();
        return (data.products || []).filter((p) => p.product_name && p.nutriments);
    }

    async function searchUsdaFoods(query) {
        const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=5&api_key=DEMO_KEY`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Unable to search USDA source.");
        }
        const data = await response.json();
        return (data.foods || []).filter((food) => food.description && food.foodNutrients);
    }

    function nutritionFromProduct(product, quantity, unit) {
        const factor = unit === "grams" ? quantity / 100 : quantity;
        const n = product.nutriments || {};

        return {
            calories: Math.round((n["energy-kcal_100g"] || n["energy-kcal"] || 0) * factor),
            protein: Number((n.proteins_100g || n.proteins || 0) * factor),
            carbs: Number((n.carbohydrates_100g || n.carbohydrates || 0) * factor),
            fat: Number((n.fat_100g || n.fat || 0) * factor)
        };
    }

    function nutrientValueFromUsda(food, matches) {
        const nutrient = (food.foodNutrients || []).find((item) =>
            matches.some((match) => (item.nutrientName || "").toLowerCase().includes(match))
        );
        return Number(nutrient?.value || 0);
    }

    function nutritionFromUsda(food, quantity, unit) {
        const calories = nutrientValueFromUsda(food, ["energy"]);
        const protein = nutrientValueFromUsda(food, ["protein"]);
        const carbs = nutrientValueFromUsda(food, ["carbohydrate"]);
        const fat = nutrientValueFromUsda(food, ["total lipid", "fat"]);

        const factor = unit === "grams" ? quantity / 100 : quantity;

        return {
            calories: Math.round(calories * factor),
            protein: Number(protein * factor),
            carbs: Number(carbs * factor),
            fat: Number(fat * factor)
        };
    }

    function mergeNutritionCandidates(candidates) {
        const valid = candidates.filter(Boolean);
        if (!valid.length) {
            return null;
        }

        const aggregate = (key) => valid.reduce((sum, item) => sum + Number(item[key] || 0), 0) / valid.length;
        return {
            calories: Math.round(aggregate("calories")),
            protein: aggregate("protein"),
            carbs: aggregate("carbs"),
            fat: aggregate("fat")
        };
    }

    async function getBestSourceMatches(foodName) {
        const openFoodFactsResults = await searchFoods(foodName);
        const bestOpenFoodFactsMatch =
            openFoodFactsResults.find((item) => item.product_name?.toLowerCase() === foodName.toLowerCase()) || openFoodFactsResults[0];

        let bestUsdaMatch = null;
        try {
            const usdaResults = await searchUsdaFoods(foodName);
            bestUsdaMatch = usdaResults.find((item) => item.description?.toLowerCase() === foodName.toLowerCase()) || usdaResults[0];
        } catch {
            bestUsdaMatch = null;
        }

        return { bestOpenFoodFactsMatch, bestUsdaMatch };
    }

    function nutritionFromMatches(matches, quantity, unit) {
        const { bestOpenFoodFactsMatch, bestUsdaMatch } = matches;
        const openFoodFactsNutrition = bestOpenFoodFactsMatch ? nutritionFromProduct(bestOpenFoodFactsMatch, quantity, unit) : null;
        const usdaNutrition = bestUsdaMatch ? nutritionFromUsda(bestUsdaMatch, quantity, unit) : null;
        return mergeNutritionCandidates([openFoodFactsNutrition, usdaNutrition]);
    }

    async function estimateNutritionWithAiMealParser(description, apiKey, model, mealMultiplier) {
        const items = await parseMealWithLlm(description, apiKey, model);
        const itemEstimates = await Promise.all(items.map(async (item) => {
            const matches = await getBestSourceMatches(item.name);
            const nutrition = nutritionFromMatches(matches, item.quantity * mealMultiplier, item.unit);
            return {
                ...item,
                nutrition,
                matches
            };
        }));

        const validEstimates = itemEstimates.filter((item) => item.nutrition);
        if (!validEstimates.length) {
            throw new Error("No nutrition data found for AI-parsed meal.");
        }

        return validEstimates.reduce(
            (acc, item) => {
                acc.calories += item.nutrition.calories;
                acc.protein += item.nutrition.protein;
                acc.carbs += item.nutrition.carbs;
                acc.fat += item.nutrition.fat;
                acc.sources.push(
                    `${item.name}: ${
                        [
                            item.matches.bestOpenFoodFactsMatch
                                ? `Open Food Facts "${item.matches.bestOpenFoodFactsMatch.product_name}"`
                                : null,
                            item.matches.bestUsdaMatch
                                ? `USDA "${item.matches.bestUsdaMatch.description}"`
                                : null
                        ]
                            .filter(Boolean)
                            .join(" + ")
                    }`
                );
                return acc;
            },
            { calories: 0, protein: 0, carbs: 0, fat: 0, sources: [] }
        );
    }

    function refreshDashboard() {
        const totals = entries.reduce(
            (acc, entry) => {
                acc.calories += entry.calories;
                acc.protein += entry.protein;
                acc.carbs += entry.carbs;
                acc.fat += entry.fat;
                return acc;
            },
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
        );

        totalCalories.textContent = Math.round(totals.calories).toString();
        totalProtein.textContent = `${formatNumber(totals.protein)} g`;
        totalCarbs.textContent = `${formatNumber(totals.carbs)} g`;
        totalFat.textContent = `${formatNumber(totals.fat)} g`;

        const byDate = entries.reduce((acc, entry) => {
            acc[entry.date] = acc[entry.date] || { calories: 0, protein: 0 };
            acc[entry.date].calories += entry.calories;
            acc[entry.date].protein += entry.protein;
            return acc;
        }, {});

        const labels = Object.keys(byDate).sort();
        chart.data.labels = labels;
        chart.data.datasets[0].data = labels.map((l) => Math.round(byDate[l].calories));
        chart.data.datasets[1].data = labels.map((l) => Number(byDate[l].protein.toFixed(1)));
        chart.update();
    }

    function addEntryToTable(entry) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${entry.date}</td>
            <td>${entry.time}</td>
            <td>${entry.food}</td>
            <td>${entry.quantity} ${entry.unit}</td>
            <td>${Math.round(entry.calories)}</td>
            <td>${formatNumber(entry.protein)}</td>
            <td>${formatNumber(entry.carbs)}</td>
            <td>${formatNumber(entry.fat)}</td>
        `;
        foodTable.appendChild(row);
    }

    function showError(message) {
        reviewPanel.classList.remove("hidden");
        reviewFood.textContent = message;
        reviewFood.classList.add("error");
        reviewSource.textContent = "Try a more specific food description.";
        reviewCalories.value = "0";
        reviewProtein.value = "0";
        reviewCarbs.value = "0";
        reviewFat.value = "0";
        pendingEntry = null;
    }

    foodSearch.addEventListener("input", async () => {
        const query = foodSearch.value.trim();
        if (query.length < 2) {
            foodSuggestions.innerHTML = "";
            return;
        }

        try {
            suggestions = await searchFoods(query);
            setSuggestions(suggestions);
        } catch {
            foodSuggestions.innerHTML = "";
        }
    });

    foodForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        reviewFood.classList.remove("error");

        const food = foodSearch.value.trim();
        const quantity = Number(quantityInput.value);
        const unit = unitInput.value;

        if (!food || !quantity) {
            return;
        }

        reviewPanel.classList.remove("hidden");
        reviewFood.textContent = `Searching nutrition data for "${food}"...`;
        reviewSource.textContent = "";

        try {
            let nutrition = null;
            let sources = [];
            const useAiAssist = useAiAssistInput.checked;

            if (useAiAssist) {
                const apiKey = openAiKeyInput.value.trim();
                const model = openAiModelInput.value;
                if (!apiKey) {
                    showError("Add your OpenAI API key to use AI meal parsing.");
                    return;
                }

                const aiEstimate = await estimateNutritionWithAiMealParser(food, apiKey, model, quantity);
                nutrition = aiEstimate;
                sources = aiEstimate.sources;
            } else {
                const matches = await getBestSourceMatches(food);
                if (!matches.bestOpenFoodFactsMatch && !matches.bestUsdaMatch) {
                    showError("No nutrition result found.");
                    return;
                }

                nutrition = nutritionFromMatches(matches, quantity, unit);
                sources = [
                    matches.bestOpenFoodFactsMatch ? `Open Food Facts: "${matches.bestOpenFoodFactsMatch.product_name}"` : null,
                    matches.bestUsdaMatch ? `USDA FoodData Central: "${matches.bestUsdaMatch.description}"` : null
                ].filter(Boolean);
            }

            pendingEntry = {
                date: dateInput.value,
                time: timeInput.value,
                food,
                quantity,
                unit,
                ...nutrition
            };

            reviewFood.textContent = `Review nutrition for: ${food}`;
            reviewCalories.value = Math.round(nutrition.calories);
            reviewProtein.value = formatNumber(nutrition.protein);
            reviewCarbs.value = formatNumber(nutrition.carbs);
            reviewFat.value = formatNumber(nutrition.fat);
            reviewSource.textContent = `Smart sources used: ${sources.join(" • ")}`;
        } catch {
            showError("Could not fetch nutrition data right now.");
        }
    });

    approveBtn.addEventListener("click", () => {
        if (!pendingEntry) {
            return;
        }

        const approvedEntry = {
            ...pendingEntry,
            calories: Number(reviewCalories.value) || 0,
            protein: Number(reviewProtein.value) || 0,
            carbs: Number(reviewCarbs.value) || 0,
            fat: Number(reviewFat.value) || 0
        };

        entries.push(approvedEntry);
        addEntryToTable(approvedEntry);
        refreshDashboard();

        pendingEntry = null;
        foodForm.reset();
        foodSuggestions.innerHTML = "";
        suggestions = [];
        reviewPanel.classList.add("hidden");
        quantityInput.value = "1";
        dateInput.value = now.toISOString().split("T")[0];
        timeInput.value = now.toTimeString().split(" ")[0].slice(0, 5);
    });

    cancelBtn.addEventListener("click", () => {
        pendingEntry = null;
        reviewPanel.classList.add("hidden");
    });
});
