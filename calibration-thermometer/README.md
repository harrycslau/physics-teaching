# Calibration Thermometer

An inquiry-based virtual laboratory in which students discover how to calibrate an
unmarked liquid-in-glass thermometer using the two fixed points of the Celsius scale.

## Running

No build step or dependencies. Open `index.html` in any modern browser, or serve the folder:

```
python3 -m http.server 8000
# then visit http://localhost:8000/calibration-thermometer/
```

## What students can do

- Drag any apparatus: two beakers, a water jug, an ice bucket, a hot plate, and a stirring rod.
- Add water by holding the jug over a beaker; take ice cubes out of the bucket and drop them in.
- Switch the hot plate on/off (click its switch) and slide it under either beaker.
- Stir by moving the rod in circles inside a beaker; watch mixing visibly speed up.
- Dip the thermometer's bulb into any beaker (or leave it in air) — the column lags and settles realistically.
- Mark the stem at any moment with the **Mark** tool, remove marks with **Erase**, and use
  **Divide ×10** once two marks exist.
- Nothing is evaluated or gated. A quiet "reading steady" indicator appears when the column has settled.
- The **Speed** button in the header cycles 1× / 2× / 4× simulation rate for quicker heating and cooling.

## Physics modelled (`js/physics.js`)

- Ambient heat exchange, first-order thermometer lag and stabilization detection.
- Ice melting only into liquid water; stirred ice–water mixtures converge near 0 °C,
  unstirred ones settle a few degrees warm (stratification bias).
- Ice without water does not provide a reproducible reference point.
- Heating power scales with water mass; boiling plateaus near 100 °C with slow evaporation.
- Water level changes from pouring, melting ice, and evaporation.

Completion is detected silently when the student places plausible 0 °C / 100 °C marks in the
right order and divides them into ten equal parts; a short summary then explains why the
calibration works. Three progressive hints are available only via the Hint button.
