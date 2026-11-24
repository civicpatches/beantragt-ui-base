<script setup lang="ts">
definePageMeta({
    layout: false
});

const route = useRoute();
const refNumber = Array.isArray(route.params.ref) ? route.params.ref[0] : route.params.ref;

onMounted(() => {
    void navigateTo({
        path: '/status',
        query: typeof refNumber === 'string' ? { ref: refNumber } : undefined
    }, { replace: true });
});
</script>

<template>
  <div />
</template>
