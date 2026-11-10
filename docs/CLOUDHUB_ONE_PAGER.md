# CloudHub One Pager

## Overview
CloudHub is the platform experience layer for internal engineering teams: a Backstage-powered portal that brings service catalog, deployment workflows, developer onboarding, and operational visibility into a single place. It is designed to help teams discover apps, manage lifecycle tasks, and ship changes with guardrails instead of fragmented tooling.

## What CloudHub does
CloudHub unifies several platform capabilities:

- Service catalog and developer portal for apps and platform components
- Deployment orchestration across Azure App Service and AKS workflows
- GitHub Actions integration for build, validation, and promotion pipelines
- Authentication and authorization via Microsoft Entra ID and platform groups
- Environment configuration for local, dev, and production deployment profiles
- Helm/chart-based infrastructure and platform tooling for reusable deployment patterns

## Core platform story
This repository is not just a frontend app; it is a platform operating model. It combines:

- Backstage as the user experience and catalog foundation
- App and plugin modules for platform workflows
- Infrastructure-as-code assets for Azure and Kubernetes deployments
- CI/CD automation for image build, release, and deployment
- Configured integration points for GitHub, Azure, and PostgreSQL

## Key capabilities
### 1. Catalog and developer experience
Teams can use CloudHub to register, discover, and manage internal components and platform services. The portal acts as the source of truth for what exists, who owns it, and how it is deployed.

### 2. Deployment automation
The repository includes workflows for:

- Building frontend and backend images
- Deploying app services and AKS-based workloads
- Supporting image-tag based deployment models
- Triggering platform deployment pipelines via GitHub Actions

### 3. Azure and GitHub integration
CloudHub is built to work with:

- Microsoft Entra ID authentication and group-based access control
- Azure subscription, resource group, and App Service management
- Azure PostgreSQL for production runtime data
- GitHub repositories, release flows, and repo provisioning controls

### 4. Operational governance
The platform enforces approvals, deployment rules, and environment-specific behavior using config profiles and deployment metadata. This reduces the risk of ad hoc changes while preserving velocity.

## Reference architecture
- Frontend: Backstage application and UI layer
- Backend: platform API and service integrations
- Data layer: PostgreSQL-backed runtime configuration and catalog data
- CI/CD: GitHub Actions for validation, build, and deployment
- Cloud target: Azure App Service and AKS ecosystems
- Infra: Helm charts and deployment templates

## Why it matters
CloudHub helps teams move from scattered tools to a single operational control plane. It reduces setup friction, gives engineering teams a clearer view of platform assets, and standardizes how services are built, promoted, and operated.

## Typical user personas
- Platform engineers: manage infrastructure, rollout patterns, and governance
- Application teams: discover services, onboard workloads, and deploy updates
- Security and operations: enforce identity, access, and policy controls
- DevOps teams: automate pipelines and release quality gates

## Current project positioning
The repository demonstrates a mature internal platform direction: a developer portal paired with real deployment automation, cloud-native provisioning, and enterprise identity integration. In practical terms, CloudHub functions as the control plane for modern engineering operations inside Azure and GitHub ecosystems.

## Summary
CloudHub is a Backstage-driven platform portal that turns software delivery into a governed, repeatable system. It combines cataloging, deployment automation, cloud integrations, and security controls into one operational foundation for internal platform teams.
