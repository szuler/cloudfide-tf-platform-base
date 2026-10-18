mock_provider "azurerm" {}

variables {
  name                = "sttptest001"
  resource_group_name = "rg-test"
  location            = "westeurope"
  containers          = ["raw", "curated"]
}

run "account_is_locked_down_by_default" {
  command = plan

  assert {
    condition     = azurerm_storage_account.this.min_tls_version == "TLS1_2"
    error_message = "The account must require TLS 1.2."
  }

  assert {
    condition     = azurerm_storage_account.this.allow_nested_items_to_be_public == false
    error_message = "Public blob access must be off."
  }

  assert {
    condition     = azurerm_storage_account.this.https_traffic_only_enabled == true
    error_message = "HTTPS-only traffic must be enforced."
  }

  assert {
    condition     = azurerm_storage_account.this.shared_access_key_enabled == false
    error_message = "Shared access keys must be disabled; use identity-based auth."
  }

  assert {
    condition     = azurerm_storage_account_network_rules.this.default_action == "Deny"
    error_message = "Network access must be denied by default."
  }
}

run "creates_one_container_per_name" {
  command = plan

  assert {
    condition     = length(azurerm_storage_container.this) == 2
    error_message = "Expected one container for each name."
  }

  assert {
    condition     = toset(keys(azurerm_storage_container.this)) == toset(["raw", "curated"])
    error_message = "Container keys must match the names provided in var.containers."
  }
}

run "containers_are_private" {
  command = plan

  assert {
    condition     = alltrue([for c in azurerm_storage_container.this : c.container_access_type == "private"])
    error_message = "All containers must use private access — no public blob or container access."
  }
}

run "default_replication_is_lrs" {
  command = plan

  assert {
    condition     = azurerm_storage_account.this.account_replication_type == "LRS"
    error_message = "Default replication type must be LRS."
  }
}

run "data_lake_enables_hns" {
  command = plan

  variables {
    is_data_lake = true
  }

  assert {
    condition     = azurerm_storage_account.this.is_hns_enabled == true
    error_message = "Setting is_data_lake=true must enable the hierarchical namespace."
  }
}

run "no_containers_when_none_given" {
  command = plan

  variables {
    containers = []
  }

  assert {
    condition     = length(azurerm_storage_container.this) == 0
    error_message = "No containers should be created when the containers variable is empty."
  }
}

run "rejects_invalid_name" {
  command = plan

  variables {
    name = "Invalid-Name"
  }

  expect_failures = [var.name]
}
