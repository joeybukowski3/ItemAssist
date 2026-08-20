# Normalized Product Schema

This is a conceptual data contract. Keep universal identity, commerce, evidence, and relationship fields stable while placing category attributes in typed extensions. Do not force every product into one giant sparse schema.

## Provenanced values

Important facts should use field-level provenance:

```json
{
  "value": "55",
  "unit": "in",
  "status": "confirmed",
  "source": {
    "source_id": "src-001",
    "url": "https://manufacturer.example/product",
    "publisher": "Example Manufacturer",
    "title": "Product specifications"
  },
  "observed_at": "2026-08-20T14:00:00Z",
  "confidence": 0.98,
  "normalization_note": "Converted manufacturer diagonal measurement to inches"
}
```

Allowed evidence statuses are `confirmed`, `inferred`, `user_supplied`, and `unverified`; use a null value with status `unverified` or a separate `unknown` reason when no value exists. Confidence describes identity/extraction certainty, not LKQ similarity.

## Universal product record

```text
id
category
brand
manufacturer
model_number
product_name
release_year
discontinued
status

positioning
original_msrp
observed_price
price_source
price_observed_at

source_urls
verification_status
confidence
category_attributes
```

Recommended meanings:

- `id`: stable internal identifier, never derived only from a mutable display name.
- `category`: controlled enum such as `tv`, `refrigerator`, or `av_receiver`.
- `model_number`: exact normalized variant, preserving the raw user string separately.
- `status`: lifecycle/market state such as `current`, `discontinued`, `unavailable`, or `unknown`.
- `positioning`: generation-relative category position with evidence and method.
- `observed_price`: money object with amount, currency, seller, region, status, and provenance; never a timeless scalar.
- `source_urls`: deduplicated source registry; field references should point to source IDs.
- `verification_status`: overall research state, not a replacement classification.
- `confidence`: confidence in identification or normalized evidence, not the LKQ score.
- `category_attributes`: one category-specific extension described below.

Preserve raw extracted values alongside normalized values when conversion or controlled-vocabulary mapping occurs.

## Source record

```text
source_id
source_type: manufacturer | manual | spec_sheet | authorized_retailer | database | secondary
publisher
title
url
retrieved_at
publication_date
supports_fields
excerpt_or_locator
archive_url
```

For price and availability, also store seller, region, currency, condition, observation timestamp, and freshness state.

## Requirement record

```text
requirement_id
attribute_path
operator
target_value
tolerance
severity: hard | conditional | soft
activation_reason
source_fields
unknown_behavior
relaxable_at_fallback_level
failure_code
explanation
```

Requirements are derived from accepted normalized inputs and versioned category rules. They are not free-form LLM conclusions.

## Candidate relationship

```text
original_product_id
candidate_product_id

eligibility_pass
eligibility_state
failed_requirements

score
classification

score_breakdown
fallback_level
relaxed_constraints
overshoot_adjustment

scoring_config_version
scored_at
```

`score_breakdown` should contain components with rule ID, input values, possible points, earned points, and explanation. Store pre-penalty score, penalties, pre-cap score, fallback cap, and final score separately so the calculation is auditable.

## Research run

```text
research_run_id
original_user_input
selected_original_product_id
identity_alternatives
research_confidence
requirements
candidate_relationships
source_registry
unknowns
conflicts
assumptions
created_at
refreshed_at
scoring_config_version
```

This record is the reproducibility boundary. A refreshed price observation should not erase the previous run.

## Category extensions

### TV

```text
screen_size_inches
resolution
display_technology
backlight_technology
smart_capability
smart_platform
native_refresh_rate_hz
hdr_formats
hdr_tier
hdmi_capabilities
hdmi_port_count
tuner
audio_capabilities
series_position
```

See [categories/TV.md](categories/TV.md).

### Refrigerator

```text
configuration
width_inches
height_inches
depth_inches
depth_class
total_capacity_cuft
refrigerator_capacity_cuft
freezer_capacity_cuft
door_count
dispenser_configuration
ice_maker
finish
smart_capability
series_position
```

Installation-envelope facts may be user constraints rather than product facts; store their provenance. See [categories/REFRIGERATOR.md](categories/REFRIGERATOR.md).

### AV receiver

```text
channel_configuration
amplifier_channels
processed_channels
rated_power
hdmi_input_count
hdmi_output_count
hdmi_capabilities
video_support
hdr_formats
arc_earc
dolby_atmos
dts_x
room_correction
networking
bluetooth
wifi
multi_zone
pre_outs
phono_input
series_position
```

`rated_power` must include measurement conditions such as impedance, frequency range, channel count driven, and distortion where available. See [categories/AV_RECEIVER.md](categories/AV_RECEIVER.md).

## Validation rules

- Never use a confidence field as a score component unless a documented data-quality policy calls for a result cap; even then, keep it separate from similarity points.
- Never interpret missing boolean data as `false`.
- Require units for physical measurements and normalize without losing the source value.
- Treat model variants as distinct until evidence proves their specifications equivalent.
- Require timestamps for price and availability observations.
- Store the scoring configuration version with every relationship result.
