# Competition datasets

Place the Tech-Triathlon 2026 dataset files here, keeping the organisers' folder names:

```
data/
  General Data/        outlets.csv, vehicles.csv, calendar.csv, district_travel.csv,
                       service_allowance.csv, traffic_speed.csv, road_conditions.csv
  Training Data/       deliveries_train.csv, route_legs_train.csv
  Test Data/           task1_test_inputs.csv, route_legs_test.csv, task2a_test_inputs.csv,
                       task2b_peak_day_scenarios.csv, task2b_peak_day_fleet.csv
  Submission Templates/
```

The folder is mounted read-only into the `api` container at `/data` for seeding.

**Not committed.** The competition T&C forbid redistributing the datasets, so `data/**/*.csv` is gitignored. Confirm with tech-triathlon@rootcode.io whether the reference CSVs may be included in the public repo; the brief requires `docker compose up` to seed them on a fresh install.
