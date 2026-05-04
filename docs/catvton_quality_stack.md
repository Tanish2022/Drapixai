# DrapixAI CatVTON Production Stack

DrapixAI quality comes from the full try-on system, not from CatVTON alone.

## Application Stack

- Frontend: Next.js storefront and DrapixAI SDK.
- API layer: Node/Express, Prisma, PostgreSQL.
- Queue layer: Redis with RQ jobs.
- AI service: FastAPI endpoints plus a separate Python GPU worker.
- Core model: CatVTON.
- GPU runtime: RunPod Linux Ubuntu GPU is the source of truth.
- Image processing: Pillow, OpenCV, NumPy, scikit-image, rembg and segmentation tools.
- Storage: PostgreSQL for records, S3 or MinIO for images, local cache for development.
- Deployment: RunPod A100 or A10 first, Docker, Redis, split AI API and AI worker processes.

## Final RunPod Stack

- OS: Ubuntu 22.04.
- Base image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`.
- Python: 3.11.
- CUDA: 12.4.1.
- GPU target: A100 preferred, A10 acceptable, T4 only for low-cost testing.

Windows/local smoke tests are not quality gates. They are useful only for syntax and basic integration checks.

## Model Runtime

Pinned Python packages:

- `torch==2.4.0`
- `torchvision==0.19.0`
- `xformers==0.0.27.post2`
- `fastapi==0.115.0`
- `uvicorn[standard]==0.30.6`
- `redis==5.0.8`
- `rq==1.16.2`
- `python-multipart==0.0.9`
- `requests==2.32.3`
- `boto3==1.34.131`
- `accelerate==0.34.2`
- `transformers==4.46.3`
- `diffusers==0.31.0`
- `huggingface_hub>=0.34.0,<2.0`
- `safetensors`
- `peft==0.17.0`
- `einops==0.7.0`
- `pillow==10.3.0`
- `numpy==1.26.4`
- `opencv-python==4.10.0.84`
- `scipy==1.13.1`
- `scikit-image==0.24.0`
- `matplotlib==3.9.1`
- `PyYAML==6.0.1`
- `tqdm==4.66.4`
- `rembg==2.0.57`
- `onnxruntime==1.23.2`
- `fvcore==0.1.5.post20221221`
- `cloudpickle==3.0.0`
- `omegaconf==2.3.0`
- `pycocotools==2.0.8`
- `av==12.3.0`

System packages:

- `curl`
- `ffmpeg`
- `git`
- `libgl1`
- `libglib2.0-0`
- `libgomp1`
- `libsm6`
- `libxext6`
- `libxrender1`
- `redis-server`

CatVTON support packages:

- CatVTON third-party checkout under `drapixai_ai/third_party/CatVTON`
- CatVTON weights under `models/catvton`
- official AutoMasker dependencies for DensePose and SCHP masks

## Try-On Flow

1. User submits person image and garment image from the storefront or SDK.
2. API validates request size, plan, garment type, and user limits.
3. Garment preprocessing normalizes, validates, and caches the garment.
4. API enqueues a Redis job.
5. RQ GPU worker receives the job and calls the DrapixAI pipeline.
6. Person validation and analysis run before generation.
7. Mask generation uses CatVTON AutoMasker by default, with DrapixAI fallback masks.
8. CatVTON generates candidates.
9. Quality scorer ranks candidates and rejects weak outputs with warnings.
10. Best result and metadata are logged and stored.
11. API returns image bytes without breaking existing `/ai/tryon` and `/sdk/tryon` clients.
12. Admin review and user feedback feed future quality improvements.

## Generation Modes

- Standard mode: generate 1 CatVTON output.
- Enhanced mode: generate 3 to 4 CatVTON outputs, score all candidates, and return the best.

Enhanced mode is the realism path for launch. Standard mode exists for lower latency and cheaper plans.

## Quality Layer

Quality is owned by DrapixAI around the model:

- person validator
- person analyzer
- garment analyzer
- mask builder
- image normalizer
- CatVTONEngine
- try-on scorer
- candidate ranking
- bad result rejection
- manual review queue
- feedback learning loop

The current scorer tracks:

- face preservation
- body preservation
- garment color similarity
- garment texture similarity
- edge artifacts
- image artifact risk
- overall realism

Each result stores selected candidate metadata, candidate scores, input analysis, and warnings so the API/admin layer can review bad outputs without changing the binary image response.

## Quality Boosters

Current and planned boosters:

- better person and garment masks
- multi-output generation
- auto quality scoring
- conservative refinement for brightness harmonization and garment color recovery
- detail restore for texture, edges, logos, prints, buttons, and embroidery
- future FLUX-style refinement for blending, folds, shadows, and garment-body contact

## Production Rules

- Do not judge CatVTON from low-step smoke tests.
- Quality review must use full-resolution inputs, normal inference steps, and AutoMasker masks.
- CatVTON rollout is gated by the expanded test matrix and manual visual review.
- Production default requires stable Redis job execution, S3/MinIO writes, and recorded quality metadata.
- IDM-VTON is removed; CatVTON is the only active model path.
