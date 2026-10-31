# CI/CD Pipeline Architecture

This document describes the automated deployment and build infrastructure. The architecture is designed for modularity, allowing for environment-specific deployments (DB, Backend, Frontend) triggered either by the main stack or individual dispatch events.

## Architecture Diagram

```mermaid
flowchart TD
%% Global Styling
classDef successIcon color:#2da44e;
classDef trigger fill:#f6f8fa,stroke:#d0d7de;
classDef decision fill:#fff8c5,stroke:#d4a017;

%% 1. ORCHESTRATOR
subgraph s_sub["1. stack (Orchestrator)"]
s_start(("On push to main\nor PR")):::trigger --> s_db["DB Deploy"]
s_db --> s_be["Backend Deploy"]
s_be --> s_fe["Frontend Deploy"]
s_fe --> s_end(("✅"))
class s_end successIcon
end

%% PILLAR: DATABASE
subgraph pillar_db["DATABASE ARCHITECTURE"]
%% 2. DATABASE SIMPLE
subgraph dbs_sub["2. database"]
dbs_start(("on dispatch")):::trigger --> dbs_dep["DB Deploy"]
dbs_dep --> dbs_end(("✅"))
class dbs_end successIcon
end

    %% 3. REUSABLE DATABASE
    subgraph rd_sub["3. Reusable-database"]
      rd_start(("DB Deploy")) --> rd_del["delete stale deployments"]
      rd_del --> rd_exist{"DB exist\non branch?"}:::decision
      rd_exist -- "N" --> rd_copy["Copy production DB"]
      rd_exist -- "Y" --> rd_choose["Choose existing DB"]
      rd_copy --> rd_chosen["Chosen DB"]
      rd_choose --> rd_chosen
      rd_chosen --> rd_det["Detect Changes"]
      rd_det --> rd_any{"any changes?"}:::decision
      rd_any -- "Y" --> rd_apply["Apply migrations"]
      rd_apply --> rd_ready
      rd_any -- "N" --> rd_ready(("✅ DB ready"))
      class rd_ready successIcon
    end

    %% 4. BUILD DETAIL DB
    subgraph bd_sub["4. Build Detail (DB)"]
      bd_start(("build needed")) --> bd_setup["set up uv and python"]
      bd_setup --> bd_inst["install dependencies"]
      bd_inst --> bd_sett["resolve settings"]
      bd_sett --> bd_rel["release update"]
      bd_rel --> bd_rep(("report instance"))
    end
end

%% PILLAR: BACKEND
subgraph pillar_be["BACKEND ARCHITECTURE"]
%% 5. BACKEND SIMPLE
subgraph bes_sub["5. backend"]
bes_start(("on dispatch")):::trigger --> bes_dep["backend Deploy"]
bes_dep --> bes_end(("✅"))
class bes_end successIcon
end

    %% 6. REUSABLE BACKEND
    subgraph rb_sub["6. Reusable-backend"]
      rb_start(("backend Deploy")) --> rb_del["delete stale deployments"]
      rb_del --> rb_exist{"backend exist?"}:::decision
      rb_exist -- "N" --> rb_copy["Copy production"]
      rb_exist -- "Y" --> rb_choose["Choose existing"]
      rb_copy --> rb_chosen["Chosen BE"]
      rb_choose --> rb_chosen
      rb_chosen --> rb_det["Detect Changes"]
      rb_det --> rb_any{"any changes?"}:::decision
      rb_any -- "Y" --> rb_build["build backend"]
      rb_build --> rb_ready
      rb_any -- "N" --> rb_ready(("✅ BE ready"))
      class rb_ready successIcon
    end

    %% 7. BUILD DETAIL BACKEND
    subgraph bb_sub["7. Build Detail (Backend)"]
      bb_1(("build needed")) --> bb_2["set up uv and python"]
      bb_2 --> bb_3["install dependencies"]
      bb_3 --> bb_4["Lint"]
      bb_4 --> bb_5["Format"]
      bb_5 --> bb_6["run tests"]
      bb_6 --> bb_7["set up Vercel CLI"]
      bb_7 --> bb_8["pull configuration"]
      bb_8 --> bb_9["package version"]
      bb_9 --> bb_10["resolve settings"]
      bb_10 --> bb_11["release update"]
      bb_11 --> bb_12(("report instance"))
    end
end

%% PILLAR: FRONTEND
subgraph pillar_fe["FRONTEND ARCHITECTURE"]
%% 8. FRONTEND SIMPLE
subgraph fes_sub["8. frontend"]
fes_start(("on dispatch")):::trigger --> fes_dep["frontend Deploy"]
fes_dep --> fes_end(("✅"))
class fes_end successIcon
end

    %% 9. REUSABLE FRONTEND
    subgraph rf_sub["9. Reusable-frontend"]
      rf_start(("frontend Deploy")) --> rf_del["delete stale deployments"]
      rf_del --> rf_exist{"frontend exist?"}:::decision
      rf_exist -- "N" --> rf_copy["Copy production"]
      rf_exist -- "Y" --> rf_choose["Choose existing"]
      rf_copy --> rf_chosen["Chosen FE"]
      rf_choose --> rf_chosen
      rf_chosen --> rf_det["Detect Changes"]
      rf_det --> rf_any{"any changes?"}:::decision
      rf_any -- "Y" --> rf_build["build frontend"]
      rf_build --> rf_ready
      rf_any -- "N" --> rf_ready(("✅ FE ready"))
      class rf_ready successIcon
    end

    %% 10. BUILD DETAIL FRONTEND
    subgraph bf_sub["10. Build Detail (Frontend)"]
      bf_1(("build needed")) --> bf_2["set up Node.js and pnpm"]
      bf_2 --> bf_3["Lint"]
      bf_3 --> bf_4["Format"]
      bf_4 --> bf_5["run tests"]
      bf_5 --> bf_6["build application"]
      bf_6 --> bf_7["set up Vercel CLI"]
      bf_7 --> bf_8["pull configuration"]
      bf_8 --> bf_9["package version"]
      bf_9 --> bf_10["resolve settings"]
      bf_10 --> bf_11["release update"]
      bf_11 --> bf_12(("report instance"))
    end
end

%% TRIGGERY (PRZERYWANE)
s_db -.-> rd_start
dbs_dep -.-> rd_start
rd_apply -.-> bd_start

s_be -.-> rb_start
bes_dep -.-> rb_start
rb_build -.-> bb_1

s_fe -.-> rf_start
fes_dep -.-> rf_start
rf_build -.-> bf_1