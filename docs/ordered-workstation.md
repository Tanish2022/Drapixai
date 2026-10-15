# Ordered DrapixAI workstation

Recorded 2026-10-16 from the owner's order specification. Delivery is expected at
the end of October 2026. This records an order, not inspected hardware or a
passing deployment certification.

## Ordered configuration

| Component | Owner-provided specification |
| --- | --- |
| CPU | AMD Ryzen Threadripper PRO 9975WX; 32 cores / 64 threads; up to 5.4 GHz |
| Motherboard | ASUS WRX90E-SAGE SE |
| Memory | 8 x 32 GB Kingston ECC DDR5-5600; 256 GB total |
| GPU | NVIDIA RTX PRO 6000 Blackwell; 96 GB; exact edition to verify against invoice |
| OS drive | Samsung 9100 PRO 2 TB NVMe SSD |
| Additional drive | Samsung 9100 PRO 8 TB NVMe Gen5 SSD |
| Cooling | 360 mm AIO CPU liquid cooler; exact model to confirm |
| Power supply | 2000 W, 80 Plus Platinum; exact model to confirm |
| Case | Full-tower workstation case; exact model to confirm |
| UPS | 3000 VA; exact model, watt rating, runtime and shutdown integration to confirm |
| Operating system | Ubuntu 22.04 LTS with updated NVIDIA/CUDA drivers requested |
| Vendor support | Ant PC: stated three-year onsite parts repair/replacement, lifetime remote technical support and 30-day DOA policy; verify written terms and start dates |

## Deployment alignment

The repository already targets `DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell` in
`deploy/workstation/preflight.sh`. Keep the existing Standard release profile,
model revisions, masks, scoring and postprocessing for certification. Neither
the order nor successful host preflight establishes throughput, SDK/direct
parity, three-tenant isolation or latency performance.

The host NVIDIA driver, NVIDIA Container Toolkit and the image's CUDA/PyTorch/
xFormers stack must work together. Record exact versions and run real GPU kernels
inside the approved container. A vendor statement that CUDA is installed, or a
successful `nvidia-smi`, is insufficient evidence of CatVTON compatibility.

## Before delivery

- Confirm the GPU edition, Kingston memory part numbers and ECC RDIMM type, CPU
  cooler model and sTR5/350 W support, PSU model and GPU power cabling, and UPS
  model/output watts/runtime at measured load with Ant PC.
- Obtain the supported motherboard BIOS version for this CPU and the vendor's
  memory-validation and combined CPU/GPU thermal test results.
- Prepare the private Linux host installation, VPN-only administration, BMC
  isolation, storage encryption, monitoring and external backup destination.
- Proposed disk allocation: 2 TB for OS/container runtime and 8 TB for pinned
  models and operational artifacts, with quotas and rollback space. Confirm at
  installation; two drives in one workstation are not an independent backup.
- Prepare rights-cleared quality fixtures and the immutable AI image candidate.
  Continue CPU staging/security work while inference is unavailable.

## Acceptance after delivery

- Match the installed components and serial numbers to the invoice; keep serials
  and support records in restricted company storage.
- Verify BIOS/BMC firmware, CPU core/thread count, all eight memory modules,
  detected memory speed and ECC reporting, and both SSD capacities/health.
- Verify GPU identity, edition, memory, driver and container GPU access. Run the
  existing workstation preflight with approved images and exact release commit.
- Run sustained CPU/GPU/RAM/storage checks within vendor specifications and
  retain temperature, throttling, ECC/Xid and storage error results. Address any
  faults promptly within the documented acceptance/DOA period.
- Test UPS power-loss notification and graceful shutdown with synthetic jobs;
  measure available runtime rather than infer it from the VA rating.
- Complete direct/SDK Standard parity, the rights-cleared 50-case matrix,
  three-tenant latency/VRAM/isolation tests, GPU failure drills and independent
  assessment before serving pilot or public shopper traffic.

## Manufacturer references

- [AMD 9975WX specifications: eight-channel ECC RDIMM platform](https://www.amd.com/en/products/processors/workstations/ryzen-threadripper/9000-wx-series/amd-ryzen-threadripper-pro-9975wx.html)
- [ASUS CPU support: 9975WX validated since BIOS 1106](https://www.asus.com/wa/supportonly/pro%20ws%20wrx90e-sage%20se/helpdesk_qvl_cpu/)
- [NVIDIA Workstation Edition datasheet: 96 GB ECC GDDR7 and 600 W board power](https://www.nvidia.com/content/dam/en-zz/Solutions/data-center/rtx-pro-6000-blackwell-workstation-edition/workstation-blackwell-rtx-pro-6000-workstation-edition-nvidia-us-3519208-web.pdf)

References checked 2026-10-16. Confirm the delivered GPU edition before applying
Workstation Edition power and thermal specifications.
