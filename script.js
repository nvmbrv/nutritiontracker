document.addEventListener("DOMContentLoaded", () => {
    const foodForm = document.getElementById("foodForm");
    const foodTable = document.getElementById("foodTable");
    const foodSearch = document.getElementById("foodSearch");
    const foodSuggestions = document.getElementById("foodSuggestions");
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
            const results = suggestions.length ? suggestions : await searchFoods(food);
            const bestMatch = results.find((item) => item.product_name?.toLowerCase() === food.toLowerCase()) || results[0];

            if (!bestMatch) {
                showError("No nutrition result found.");
                return;
            }

            const nutrition = nutritionFromProduct(bestMatch, quantity, unit);
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
            reviewSource.textContent = `Source: Open Food Facts match "${bestMatch.product_name}".`;
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
