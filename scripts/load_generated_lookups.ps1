param(
    [string]$FusekiBase = "http://localhost:9030"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

$Items = @(
    @{ File = "data/generated/caal_address_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/address-types" }
    @{ File = "data/generated/caal_administrative_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/administrative-types" }
    @{ File = "data/generated/caal_countries.rdf"; Graph = "https://vocab.uclcaal.org/graph/countries" }
    @{ File = "data/generated/caal_location_accuracy_assessment.rdf"; Graph = "https://vocab.uclcaal.org/graph/location-accuracy-assessment" }
    @{ File = "data/generated/caal_classifications.rdf"; Graph = "https://vocab.uclcaal.org/graph/classifications" }
    @{ File = "data/generated/caal_designation_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/designation-types" }
    @{ File = "data/generated/caal_religions.rdf"; Graph = "https://vocab.uclcaal.org/graph/religions" }
    @{ File = "data/generated/caal_beginning_of_existence_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/beginning-of-existence-types" }
    @{ File = "data/generated/caal_content_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/content-types" }
    @{ File = "data/generated/caal_copyright_status.rdf"; Graph = "https://vocab.uclcaal.org/graph/copyright-status" }
    @{ File = "data/generated/caal_dataset_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/dataset-types" }
    @{ File = "data/generated/caal_description_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/description-types" }
    @{ File = "data/generated/caal_digital_file_formats.rdf"; Graph = "https://vocab.uclcaal.org/graph/digital-file-formats" }
    @{ File = "data/generated/caal_end_of_existence_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/end-of-existence-types" }
    @{ File = "data/generated/caal_levels.rdf"; Graph = "https://vocab.uclcaal.org/graph/levels" }
    @{ File = "data/generated/caal_name_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/name-types" }
    @{ File = "data/generated/caal_subjects.rdf"; Graph = "https://vocab.uclcaal.org/graph/subjects" }
    @{ File = "data/generated/caal_title_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/title-types" }
    @{ File = "data/generated/caal_conditions.rdf"; Graph = "https://vocab.uclcaal.org/graph/conditions" }
    @{ File = "data/generated/caal_condition_levels.rdf"; Graph = "https://vocab.uclcaal.org/graph/condition-levels" }
    @{ File = "data/generated/caal_deterioration_causes.rdf"; Graph = "https://vocab.uclcaal.org/graph/deterioration-causes" }
    @{ File = "data/generated/caal_risk_levels.rdf"; Graph = "https://vocab.uclcaal.org/graph/risk-levels" }
    @{ File = "data/generated/caal_anomaly_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/anomaly-types" }
    @{ File = "data/generated/caal_certainty.rdf"; Graph = "https://vocab.uclcaal.org/graph/certainty" }
    @{ File = "data/generated/caal_origins.rdf"; Graph = "https://vocab.uclcaal.org/graph/origins" }
    @{ File = "data/generated/caal_colours.rdf"; Graph = "https://vocab.uclcaal.org/graph/colours" }
    @{ File = "data/generated/caal_measurement_types.rdf"; Graph = "https://vocab.uclcaal.org/graph/measurement-types" }
    @{ File = "data/generated/caal_size_dimensions_original_material.rdf"; Graph = "https://vocab.uclcaal.org/graph/size-dimensions-original-material" }
    @{ File = "data/generated/caal_units_of_measurement.rdf"; Graph = "https://vocab.uclcaal.org/graph/units-of-measurement" }
    @{ File = "data/generated/caal_scripts.rdf"; Graph = "https://vocab.uclcaal.org/graph/scripts" }
    @{ File = "data/generated/caal_writing_systems.rdf"; Graph = "https://vocab.uclcaal.org/graph/writing-systems" }
)

foreach ($item in $Items) {
    $filePath = Join-Path $RepoRoot $item.File
    if (-not (Test-Path $filePath)) {
        throw "RDF file not found: $filePath"
    }

    $encodedGraph = [System.Uri]::EscapeDataString($item.Graph)
    $url = "$FusekiBase/skosmos/data?graph=$encodedGraph"

    Write-Host "Loading $($item.Graph)"
    curl.exe -sS -X PUT `
        -H "Content-Type: application/rdf+xml" `
        --data-binary "@$filePath" `
        $url

    if ($LASTEXITCODE -ne 0) {
        throw "Fuseki load failed for $($item.Graph)"
    }

    Write-Host ""
}

Write-Host "Finished loading generated CAAL lookup vocabularies."
