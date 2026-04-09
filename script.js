document.addEventListener("DOMContentLoaded", () => {
    const mealForm = document.getElementById("mealForm");
    const mealDescriptionInput = document.getElementById("mealDescription");
    const apiBaseInput = document.getElementById("apiBase");
    const status = document.getElementById("status");

    const analysisPanel = document.getElementById("analysisPanel");
    const emptyState = document.getElementById("emptyState");
    const mealName = document.getElementById("mealName");
    const itemsTable = document.getElementById("itemsTable");
    const totalsBox = document.getElementById("totalsBox");

    const recalculateBtn = document.getElementById("recalculateBtn");
    const saveMealBtn = document.getElementById("saveMealBtn");
    const savedMeals = document.getElementById("savedMeals");

    let latestAnalysis = null;

    apiBaseInput.value = localStorage.getItem("nutrition_api_base") || "";

    function getApiBase() {
        const raw = apiBaseInput.value.trim();
        localStorage.setItem("nutrition_api_base", raw);
        return raw || window.location.origin;
    }

    function formatNumber(value, decimals = 1) {
        return Number(value || 0).toFixed(decimals);
    }

    function totalsFromTable() {
        const rows = [...itemsTable.querySelectorAll("tr")];
        return rows.reduce((acc, row) => {
            acc.calories += Number(row.querySelector('[data-key="calories"]').value) || 0;
            acc.protein += Number(row.querySelector('[data-key="protein"]').value) || 0;
            acc.carbs += Number(row.querySelector('[data-key="carbs"]').value) || 0;
            acc.fat += Number(row.querySelector('[data-key="fat"]').value) || 0;
            return acc;
        }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
    }

    function renderTotals(totals) {
        totalsBox.innerHTML = `
            Total calories: ${Math.round(totals.calories)} kcal<br>
            Total protein: ${formatNumber(totals.protein)} g<br>
            Total carbs: ${formatNumber(totals.carbs)} g<br>
            Total fat: ${formatNumber(totals.fat)} g
        `;
    }

    function renderAnalysis(payload) {
        latestAnalysis = payload;
        itemsTable.innerHTML = "";

        mealName.textContent = payload.parsedMeal.meal_name || "Meal";
        payload.itemsWithNutrition.forEach((item) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${item.food}</td>
                <td><input type="number" value="${item.amount}" step="0.1"></td>
                <td>${item.unit}</td>
                <td><input data-key="calories" type="number" value="${Math.round(item.calories)}" step="1"></td>
                <td><input data-key="protein" type="number" value="${formatNumber(item.protein)}" step="0.1"></td>
                <td><input data-key="carbs" type="number" value="${formatNumber(item.carbs)}" step="0.1"></td>
                <td><input data-key="fat" type="number" value="${formatNumber(item.fat)}" step="0.1"></td>
            `;
            itemsTable.appendChild(row);
        });

        renderTotals(payload.totals);
        emptyState.classList.add("hidden");
        analysisPanel.classList.remove("hidden");
    }

    function loadSavedMeals() {
        const data = JSON.parse(localStorage.getItem("saved_meals") || "[]");
        savedMeals.innerHTML = "";
        data.forEach((meal) => {
            const li = document.createElement("li");
            li.textContent = `${meal.date} — ${meal.mealName}: ${meal.calories} kcal, P ${meal.protein}g / C ${meal.carbs}g / F ${meal.fat}g`;
            savedMeals.appendChild(li);
        });
    }

    mealForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const mealDescription = mealDescriptionInput.value.trim();
        if (!mealDescription) {
            return;
        }

        status.textContent = "Analyzing meal...";

        try {
            const response = await fetch(`${getApiBase()}/api/analyze-meal`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mealDescription })
            });

            if (!response.ok) {
                throw new Error(`Request failed (${response.status})`);
            }

            const payload = await response.json();
            renderAnalysis(payload);
            status.textContent = "Analysis ready. Edit values if needed, then confirm.";
        } catch (error) {
            status.textContent = `Could not analyze meal: ${error.message}`;
        }
    });

    recalculateBtn.addEventListener("click", () => {
        const totals = totalsFromTable();
        renderTotals(totals);
        status.textContent = "Totals recalculated from editable item values.";
    });

    saveMealBtn.addEventListener("click", () => {
        if (!latestAnalysis) {
            return;
        }

        const totals = totalsFromTable();
        const entry = {
            date: new Date().toISOString().slice(0, 10),
            mealName: mealName.textContent,
            calories: Math.round(totals.calories),
            protein: formatNumber(totals.protein),
            carbs: formatNumber(totals.carbs),
            fat: formatNumber(totals.fat)
        };

        const saved = JSON.parse(localStorage.getItem("saved_meals") || "[]");
        saved.unshift(entry);
        localStorage.setItem("saved_meals", JSON.stringify(saved.slice(0, 30)));
        loadSavedMeals();
        status.textContent = "Meal saved to local storage.";
    });

    loadSavedMeals();
});
