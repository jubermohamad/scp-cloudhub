terraform {
  cloud {
    organization = "cloudhub-platform"

    workspaces {
      tags = ["aks", "cloudhub"]
    }
  }
}
