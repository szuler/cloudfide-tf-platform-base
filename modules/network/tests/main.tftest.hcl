mock_provider "azurerm" {}

variables {
  name                = "tp-test"
  resource_group_name = "rg-test"
  location            = "westeurope"
  address_space       = ["10.10.0.0/16"]
  subnets = {
    apps = {
      address_prefixes  = ["10.10.0.0/24"]
      service_endpoints = ["Microsoft.Storage"]
    }
    data = {
      address_prefixes = ["10.10.1.0/24"]
    }
  }
}

run "creates_one_subnet_and_nsg_per_key" {
  command = plan

  assert {
    condition     = length(azurerm_subnet.this) == 2
    error_message = "Expected one subnet for each key in var.subnets."
  }

  assert {
    condition     = length(azurerm_network_security_group.this) == 2
    error_message = "Expected one network security group for each subnet."
  }

  assert {
    condition     = length(azurerm_subnet_network_security_group_association.this) == 2
    error_message = "Every subnet must be associated with its network security group."
  }
}

run "names_follow_the_convention" {
  command = plan

  assert {
    condition     = azurerm_virtual_network.this.name == "vnet-tp-test"
    error_message = "The virtual network name must start with vnet-."
  }

  assert {
    condition     = azurerm_subnet.this["apps"].name == "snet-apps"
    error_message = "Subnet names must start with snet-."
  }

  assert {
    condition     = azurerm_network_security_group.this["apps"].name == "nsg-tp-test-apps"
    error_message = "NSG names must follow the nsg-<name>-<subnet-key> convention."
  }

  assert {
    condition     = azurerm_network_security_group.this["data"].name == "nsg-tp-test-data"
    error_message = "NSG names must follow the nsg-<name>-<subnet-key> convention."
  }
}

run "service_endpoints_wired_to_subnet" {
  command = plan

  assert {
    condition     = toset(azurerm_subnet.this["apps"].service_endpoints) == toset(["Microsoft.Storage"])
    error_message = "Service endpoints from var.subnets must be wired to the subnet."
  }

  assert {
    condition     = length(azurerm_subnet.this["data"].service_endpoints) == 0
    error_message = "A subnet with no service_endpoints declared must receive an empty list."
  }
}

run "tags_applied_to_network_resources" {
  command = plan

  variables {
    tags = { environment = "test", owner = "platform" }
  }

  assert {
    condition     = azurerm_virtual_network.this.tags["environment"] == "test" && azurerm_virtual_network.this.tags["owner"] == "platform"
    error_message = "Tags must be applied to the virtual network."
  }

  assert {
    condition     = azurerm_network_security_group.this["apps"].tags["environment"] == "test" && azurerm_network_security_group.this["apps"].tags["owner"] == "platform"
    error_message = "Tags must be applied to each network security group."
  }
}

run "empty_subnets_creates_no_resources" {
  command = plan

  variables {
    subnets = {}
  }

  assert {
    condition     = length(azurerm_subnet.this) == 0
    error_message = "No subnets should be created when var.subnets is empty."
  }

  assert {
    condition     = length(azurerm_network_security_group.this) == 0
    error_message = "No NSGs should be created when var.subnets is empty."
  }

  assert {
    condition     = length(azurerm_subnet_network_security_group_association.this) == 0
    error_message = "No associations should be created when var.subnets is empty."
  }
}

run "rejects_invalid_address_space" {
  command = plan

  variables {
    address_space = ["not-a-cidr"]
  }

  expect_failures = [var.address_space]
}
