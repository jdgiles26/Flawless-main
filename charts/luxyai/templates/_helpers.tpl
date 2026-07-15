{{- define "luxyai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "luxyai.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "luxyai.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "luxyai.namespace" -}}
{{- default .Release.Namespace .Values.namespaceOverride -}}
{{- end -}}

{{- define "luxyai.labels" -}}
app.kubernetes.io/name: {{ include "luxyai.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "luxyai.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "luxyai.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "luxyai.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}

{{- define "luxyai.runtimeClaim" -}}
{{- default (printf "%s-runtime" (include "luxyai.fullname" .)) .Values.persistence.existingClaim -}}
{{- end -}}

{{- define "luxyai.envFrom" -}}
- configMapRef:
    name: {{ include "luxyai.fullname" . }}-config
- secretRef:
    name: {{ .Values.secrets.oauth }}
    optional: true
{{- end -}}

{{- define "luxyai.volumeMounts" -}}
- name: runtime-store
  mountPath: /var/lib/luxyai
- name: private-algorithms
  mountPath: /var/lib/luxyai-custom
  readOnly: true
- name: runtime-tmp
  mountPath: /tmp
{{- end -}}

{{- define "luxyai.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}
